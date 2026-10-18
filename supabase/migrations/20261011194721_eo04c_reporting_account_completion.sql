begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

alter table integrations.provider_connection_lifecycle_events
  drop constraint provider_connection_lifecycle_events_event_type_check,
  add constraint provider_connection_lifecycle_events_event_type_check
    check (event_type in (
      'account_selection_staged', 'account_selection_completed',
      'account_selection_cancelled', 'reporting_account_selection_required',
      'credential_renewed', 'reauthorization_required',
      'disconnect_requested', 'disconnect_finalized', 'reconnected'
    ));

create or replace function integrations.load_pending_provider_account_selection(
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text
)
returns table (
  connection_id uuid,
  lifecycle_status text,
  connection_version bigint,
  credential_id uuid,
  granted_scopes text[]
)
language sql
security definer
set search_path = ''
as $function$
  select connection.id, connection.lifecycle_status,
         connection.connection_version, connection.credential_id,
         connection.granted_scopes
    from integrations.provider_connections as connection
    join shopify.installations as installation
      on installation.id = connection.installation_id
   where connection.workspace_id = p_workspace_id
     and connection.install_generation = p_install_generation
     and connection.provider = p_provider
     and connection.lifecycle_status = 'pending_account_selection'
     and connection.credential_id is not null
     and installation.status = 'active'
     and not exists (
       select 1
         from integrations.provider_accounts as account
        where account.connection_id = connection.id
          and account.active
     );
$function$;

create or replace function integrations.complete_pending_provider_account_selection(
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_expected_version bigint,
  p_accounts jsonb,
  p_verified_at timestamptz
)
returns table (
  connection_id uuid,
  lifecycle_status text,
  connection_version bigint,
  connected_account_count smallint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_connection integrations.provider_connections%rowtype;
  selected_count integer;
  sole_account_id bigint;
  target_status text;
  lifecycle_event_type text;
begin
  if p_connection_id is null or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads')
     or p_expected_version is null or p_expected_version < 1
     or p_accounts is null or jsonb_typeof(p_accounts) <> 'array'
     or p_verified_at is null
     or p_verified_at < statement_timestamp() - interval '10 minutes'
     or p_verified_at > statement_timestamp() + interval '1 minute' then
    raise exception 'INVALID_PENDING_PROVIDER_ACCOUNT_SELECTION';
  end if;

  selected_count := jsonb_array_length(p_accounts);
  if selected_count < 1 or selected_count > 3 then
    raise exception 'CONNECTED_ACCOUNT_CARDINALITY_INVALID';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_accounts) as item(value)
     where jsonb_typeof(item.value) <> 'object'
        or not (item.value ? 'id')
        or not (item.value ? 'name')
        or not (item.value ? 'kind')
        or not (item.value ? 'reporting_eligible')
        or item.value ?| array[
          'credential_id', 'workspace_id', 'install_generation',
          'access_token', 'refresh_token', 'token'
        ]
        or jsonb_typeof(item.value -> 'id') <> 'string'
        or jsonb_typeof(item.value -> 'name') <> 'string'
        or jsonb_typeof(item.value -> 'kind') <> 'string'
        or jsonb_typeof(item.value -> 'reporting_eligible') <> 'boolean'
        or length(btrim(item.value ->> 'id')) not between 1 and 255
        or length(btrim(item.value ->> 'name')) not between 1 and 255
        or item.value ->> 'kind' <> 'advertiser'
        or (item.value ->> 'reporting_eligible')::boolean is not true
  ) then raise exception 'ADVERTISER_ACCOUNT_EVIDENCE_INVALID'; end if;

  if (
    select count(distinct item.value ->> 'id')
      from jsonb_array_elements(p_accounts) as item(value)
  ) <> selected_count then
    raise exception 'ADVERTISER_ACCOUNT_DUPLICATE';
  end if;

  select connection.* into current_connection
    from integrations.provider_connections as connection
    join shopify.installations as installation
      on installation.id = connection.installation_id
   where connection.id = p_connection_id
     and connection.workspace_id = p_workspace_id
     and connection.install_generation = p_install_generation
     and connection.provider = p_provider
     and installation.status = 'active'
   for update of connection;

  if not found then raise exception 'ACTIVE_PROVIDER_CONNECTION_REQUIRED'; end if;
  if current_connection.lifecycle_status <> 'pending_account_selection' then
    raise exception 'PENDING_ACCOUNT_SELECTION_REQUIRED';
  end if;
  if current_connection.connection_version <> p_expected_version then
    raise exception 'PROVIDER_CONNECTION_VERSION_CONFLICT';
  end if;

  update integrations.reporting_account_bindings as binding
     set effective_to = p_verified_at
   where binding.connection_id = p_connection_id
     and binding.effective_to is null;

  update integrations.provider_accounts as account
     set active = false,
         disconnected_at = p_verified_at,
         updated_at = p_verified_at
   where account.connection_id = p_connection_id
     and account.active;

  insert into integrations.provider_accounts (
    connection_id, workspace_id, install_generation, provider,
    provider_account_id, display_name, account_kind, reporting_eligible,
    provider_status, currency_code, timezone_name, login_account_id,
    verified_at, created_at, updated_at, active, disconnected_at
  )
  select
    p_connection_id, p_workspace_id, p_install_generation, p_provider,
    item.value ->> 'id', item.value ->> 'name', 'advertiser', true,
    nullif(item.value ->> 'status', ''),
    nullif(item.value ->> 'currency', ''),
    nullif(item.value ->> 'timezone', ''),
    nullif(item.value ->> 'login_account_id', ''),
    p_verified_at, p_verified_at, p_verified_at, true, null
  from jsonb_array_elements(p_accounts) as item(value)
  on conflict on constraint provider_accounts_connection_account_unique
  do update set
    display_name = excluded.display_name,
    account_kind = 'advertiser',
    reporting_eligible = true,
    provider_status = excluded.provider_status,
    currency_code = excluded.currency_code,
    timezone_name = excluded.timezone_name,
    login_account_id = excluded.login_account_id,
    verified_at = excluded.verified_at,
    updated_at = excluded.updated_at,
    active = true,
    disconnected_at = null;

  if selected_count = 1 then
    select account.id into sole_account_id
      from integrations.provider_accounts as account
     where account.connection_id = p_connection_id
       and account.active
       and account.account_kind = 'advertiser'
       and account.reporting_eligible
     for update;

    insert into integrations.reporting_account_bindings (
      connection_id, account_id, workspace_id, install_generation, provider,
      effective_from, change_reason, created_at
    ) values (
      p_connection_id, sole_account_id, p_workspace_id, p_install_generation,
      p_provider, p_verified_at, 'initial_selection', p_verified_at
    );

    target_status := 'connected';
    lifecycle_event_type := 'account_selection_completed';
  else
    target_status := 'pending_account_selection';
    lifecycle_event_type := 'reporting_account_selection_required';
  end if;

  update integrations.provider_connections as target_connection
     set lifecycle_status = target_status,
         connection_version = target_connection.connection_version + 1,
         lifecycle_changed_at = p_verified_at,
         connected_at = case
           when target_status = 'connected' then p_verified_at
           else target_connection.connected_at
         end,
         last_verified_at = p_verified_at,
         disconnected_at = null,
         disconnect_reason = null,
         updated_at = p_verified_at
   where target_connection.id = p_connection_id;

  insert into integrations.provider_connection_lifecycle_events (
    event_id, connection_id, workspace_id, install_generation, provider,
    event_type, from_status, to_status, version_before, version_after,
    occurred_at
  ) values (
    gen_random_uuid(), p_connection_id, p_workspace_id, p_install_generation,
    p_provider, lifecycle_event_type, 'pending_account_selection',
    target_status, current_connection.connection_version,
    current_connection.connection_version + 1, p_verified_at
  );

  return query
    select connection.id, connection.lifecycle_status,
           connection.connection_version, selected_count::smallint
      from integrations.provider_connections as connection
     where connection.id = p_connection_id;
end
$function$;

create or replace function integrations.load_pending_reporting_account_selection(
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text
)
returns table (
  connection_id uuid,
  lifecycle_status text,
  connection_version bigint,
  credential_id uuid,
  granted_scopes text[],
  accounts jsonb
)
language sql
security definer
set search_path = ''
as $function$
  select connection.id, connection.lifecycle_status,
         connection.connection_version, connection.credential_id,
         connection.granted_scopes,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', account.provider_account_id,
               'name', account.display_name,
               'kind', account.account_kind,
               'reporting_eligible', account.reporting_eligible,
               'status', account.provider_status,
               'currency', account.currency_code,
               'timezone', account.timezone_name,
               'login_account_id', account.login_account_id,
               'verified_at', account.verified_at
             )
             order by account.provider_account_id
           ),
           '[]'::jsonb
         )
    from integrations.provider_connections as connection
    join shopify.installations as installation
      on installation.id = connection.installation_id
    join integrations.provider_accounts as account
      on account.connection_id = connection.id and account.active
   where connection.workspace_id = p_workspace_id
     and connection.install_generation = p_install_generation
     and connection.provider = p_provider
     and connection.lifecycle_status = 'pending_account_selection'
     and connection.credential_id is not null
     and installation.status = 'active'
     and not exists (
       select 1
         from integrations.reporting_account_bindings as binding
        where binding.connection_id = connection.id
          and binding.effective_to is null
     )
   group by connection.id, connection.lifecycle_status,
            connection.connection_version, connection.credential_id,
            connection.granted_scopes
  having count(account.id) between 2 and 3;
$function$;

create or replace function integrations.complete_pending_reporting_account_selection(
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_expected_version bigint,
  p_provider_account_id text,
  p_verified_at timestamptz
)
returns table (
  connection_id uuid,
  lifecycle_status text,
  connection_version bigint,
  reporting_account_id text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_connection integrations.provider_connections%rowtype;
  target_account integrations.provider_accounts%rowtype;
  selected_count integer;
begin
  if p_connection_id is null or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads')
     or p_expected_version is null or p_expected_version < 1
     or p_provider_account_id is null
     or p_provider_account_id <> btrim(p_provider_account_id)
     or length(p_provider_account_id) not between 1 and 255
     or p_verified_at is null
     or p_verified_at < statement_timestamp() - interval '10 minutes'
     or p_verified_at > statement_timestamp() + interval '1 minute' then
    raise exception 'INVALID_PENDING_REPORTING_ACCOUNT_SELECTION';
  end if;

  select connection.* into current_connection
    from integrations.provider_connections as connection
    join shopify.installations as installation
      on installation.id = connection.installation_id
   where connection.id = p_connection_id
     and connection.workspace_id = p_workspace_id
     and connection.install_generation = p_install_generation
     and connection.provider = p_provider
     and installation.status = 'active'
   for update of connection;

  if not found then raise exception 'ACTIVE_PROVIDER_CONNECTION_REQUIRED'; end if;
  if current_connection.lifecycle_status <> 'pending_account_selection' then
    raise exception 'PENDING_REPORTING_ACCOUNT_SELECTION_REQUIRED';
  end if;
  if current_connection.connection_version <> p_expected_version then
    raise exception 'PROVIDER_CONNECTION_VERSION_CONFLICT';
  end if;

  select count(*) into selected_count
    from integrations.provider_accounts as account
   where account.connection_id = p_connection_id
     and account.active
     and account.account_kind = 'advertiser'
     and account.reporting_eligible;

  if selected_count < 2 or selected_count > 3 then
    raise exception 'PENDING_REPORTING_ACCOUNT_SET_INVALID';
  end if;

  if exists (
    select 1
      from integrations.reporting_account_bindings as binding
     where binding.connection_id = p_connection_id
       and binding.effective_to is null
  ) then raise exception 'REPORTING_ACCOUNT_ALREADY_SELECTED'; end if;

  select account.* into target_account
    from integrations.provider_accounts as account
   where account.connection_id = p_connection_id
     and account.provider_account_id = p_provider_account_id
     and account.active
     and account.account_kind = 'advertiser'
     and account.reporting_eligible
   for update;

  if not found then
    raise exception 'REPORTING_ACCOUNT_NOT_CONNECTED_OR_INELIGIBLE';
  end if;

  update integrations.provider_accounts as account
     set verified_at = p_verified_at,
         updated_at = p_verified_at
   where account.id = target_account.id;

  insert into integrations.reporting_account_bindings (
    connection_id, account_id, workspace_id, install_generation, provider,
    effective_from, change_reason, created_at
  ) values (
    p_connection_id, target_account.id, p_workspace_id, p_install_generation,
    p_provider, p_verified_at, 'initial_selection', p_verified_at
  );

  update integrations.provider_connections as target_connection
     set lifecycle_status = 'connected',
         connection_version = target_connection.connection_version + 1,
         lifecycle_changed_at = p_verified_at,
         connected_at = p_verified_at,
         last_verified_at = p_verified_at,
         updated_at = p_verified_at
   where target_connection.id = p_connection_id;

  insert into integrations.provider_connection_lifecycle_events (
    event_id, connection_id, workspace_id, install_generation, provider,
    event_type, from_status, to_status, version_before, version_after,
    occurred_at
  ) values (
    gen_random_uuid(), p_connection_id, p_workspace_id, p_install_generation,
    p_provider, 'account_selection_completed', 'pending_account_selection',
    'connected', current_connection.connection_version,
    current_connection.connection_version + 1, p_verified_at
  );

  return query
    select connection.id, connection.lifecycle_status,
           connection.connection_version, target_account.provider_account_id
      from integrations.provider_connections as connection
     where connection.id = p_connection_id;
end
$function$;

revoke all on function integrations.load_pending_reporting_account_selection(
  uuid, bigint, text
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.complete_pending_reporting_account_selection(
  uuid, uuid, bigint, text, bigint, text, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;

grant execute on function integrations.load_pending_reporting_account_selection(
  uuid, bigint, text
) to adstable_runtime;
grant execute on function integrations.complete_pending_reporting_account_selection(
  uuid, uuid, bigint, text, bigint, text, timestamptz
) to adstable_runtime;

comment on function integrations.complete_pending_provider_account_selection(
  uuid, uuid, bigint, text, bigint, jsonb, timestamptz
) is 'Persists one to three verified connected advertisers. One advertiser is bound automatically; multiple advertisers remain pending until one explicit Reporting Account is selected.';
comment on function integrations.load_pending_reporting_account_selection(
  uuid, bigint, text
) is 'Loads only a staged two-to-three-account set that still requires one explicit Reporting Account.';
comment on function integrations.complete_pending_reporting_account_selection(
  uuid, uuid, bigint, text, bigint, text, timestamptz
) is 'Creates the initial Reporting Account binding from the staged connected-account set and only then grants connected reporting authority.';

reset role;

commit;
