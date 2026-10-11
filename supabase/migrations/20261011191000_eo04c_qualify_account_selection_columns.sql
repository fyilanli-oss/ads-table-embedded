begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

create or replace function integrations.stage_provider_account_selection(
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_credential_id uuid,
  p_granted_scopes text[],
  p_verified_at timestamptz
)
returns table (
  connection_id uuid,
  lifecycle_status text,
  connection_version bigint,
  credential_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_installation shopify.installations%rowtype;
  current_connection integrations.provider_connections%rowtype;
  previous_credential_id uuid;
  version_before bigint;
begin
  if p_connection_id is null or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads', 'klaviyo')
     or p_credential_id is null
     or p_granted_scopes is null or cardinality(p_granted_scopes) < 1
     or p_verified_at is null
     or p_verified_at < statement_timestamp() - interval '10 minutes'
     or p_verified_at > statement_timestamp() + interval '1 minute'
     or exists (
       select 1 from unnest(p_granted_scopes) as scope(value)
       where value is null or value <> btrim(value)
          or length(value) not between 1 and 200
     ) then
    raise exception 'INVALID_PROVIDER_ACCOUNT_SELECTION_STAGE';
  end if;

  select installation.* into current_installation
    from shopify.installations as installation
   where installation.workspace_id = p_workspace_id
     and installation.install_generation = p_install_generation
     and installation.status = 'active'
   for update;

  if not found then raise exception 'ACTIVE_INSTALLATION_REQUIRED'; end if;

  if not exists (
    select 1 from integrations.provider_credential_envelopes as credential
     where credential.id = p_credential_id
       and credential.installation_id = current_installation.id
       and credential.workspace_id = p_workspace_id
       and credential.install_generation = p_install_generation
       and credential.provider = p_provider
  ) then raise exception 'PROVIDER_CREDENTIAL_AUTHORITY_MISMATCH'; end if;

  select connection.* into current_connection
    from integrations.provider_connections as connection
   where connection.workspace_id = p_workspace_id
     and connection.install_generation = p_install_generation
     and connection.provider = p_provider
   for update;

  if not found then
    insert into integrations.provider_connections (
      id, installation_id, workspace_id, install_generation, provider,
      credential_id, granted_scopes, connected_at, last_verified_at,
      lifecycle_status, connection_version, lifecycle_changed_at,
      created_at, updated_at
    ) values (
      p_connection_id, current_installation.id, p_workspace_id,
      p_install_generation, p_provider, p_credential_id, p_granted_scopes,
      p_verified_at, p_verified_at, 'pending_account_selection', 1,
      p_verified_at, p_verified_at, p_verified_at
    );
  else
    if current_connection.lifecycle_status not in (
      'pending_account_selection', 'reauthorization_required', 'disconnected'
    ) then raise exception 'PROVIDER_CONNECTION_ALREADY_CONNECTED'; end if;
    if current_connection.id <> p_connection_id then
      p_connection_id := current_connection.id;
    end if;

    previous_credential_id := current_connection.credential_id;
    version_before := current_connection.connection_version;

    update integrations.provider_connections as target_connection
       set credential_id = p_credential_id,
           granted_scopes = p_granted_scopes,
           lifecycle_status = 'pending_account_selection',
           connection_version = target_connection.connection_version + 1,
           lifecycle_changed_at = p_verified_at,
           last_verified_at = p_verified_at,
           disconnected_at = null,
           disconnect_reason = null,
           updated_at = p_verified_at
     where target_connection.id = current_connection.id;

    insert into integrations.provider_connection_lifecycle_events (
      event_id, connection_id, workspace_id, install_generation, provider,
      event_type, from_status, to_status, version_before, version_after,
      occurred_at
    ) values (
      gen_random_uuid(), current_connection.id, p_workspace_id,
      p_install_generation, p_provider, 'account_selection_staged',
      current_connection.lifecycle_status, 'pending_account_selection',
      version_before, version_before + 1, p_verified_at
    );

    if previous_credential_id is not null
       and previous_credential_id <> p_credential_id then
      delete from integrations.provider_credential_envelopes as credential
       where credential.id = previous_credential_id;
    end if;
  end if;

  return query
    select connection.id, connection.lifecycle_status,
           connection.connection_version, connection.credential_id
      from integrations.provider_connections as connection
     where connection.id = p_connection_id;
end
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
  do update
    set display_name = excluded.display_name,
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

  update integrations.provider_connections as target_connection
     set lifecycle_status = 'connected',
         connection_version = target_connection.connection_version + 1,
         lifecycle_changed_at = p_verified_at,
         connected_at = p_verified_at,
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
    p_provider, 'account_selection_completed', 'pending_account_selection',
    'connected', current_connection.connection_version,
    current_connection.connection_version + 1, p_verified_at
  );

  return query
    select connection.id, connection.lifecycle_status,
           connection.connection_version, selected_count::smallint
      from integrations.provider_connections as connection
     where connection.id = p_connection_id;
end
$function$;

create or replace function integrations.cancel_pending_provider_account_selection(
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_expected_version bigint,
  p_cancelled_at timestamptz
)
returns table (
  connection_id uuid,
  lifecycle_status text,
  connection_version bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_connection integrations.provider_connections%rowtype;
begin
  if p_connection_id is null or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads')
     or p_expected_version is null or p_expected_version < 1
     or p_cancelled_at is null then
    raise exception 'INVALID_PENDING_ACCOUNT_SELECTION_CANCEL';
  end if;

  select connection.* into current_connection
    from integrations.provider_connections as connection
   where connection.id = p_connection_id
     and connection.workspace_id = p_workspace_id
     and connection.install_generation = p_install_generation
     and connection.provider = p_provider
   for update;

  if not found then raise exception 'PROVIDER_CONNECTION_NOT_FOUND'; end if;
  if current_connection.lifecycle_status <> 'pending_account_selection'
     or current_connection.connection_version <> p_expected_version then
    raise exception 'PENDING_ACCOUNT_SELECTION_CONFLICT';
  end if;

  update integrations.provider_connections as target_connection
     set credential_id = null,
         lifecycle_status = 'disconnected',
         connection_version = target_connection.connection_version + 1,
         lifecycle_changed_at = p_cancelled_at,
         disconnected_at = p_cancelled_at,
         disconnect_reason = 'merchant_cancelled_account_selection',
         updated_at = p_cancelled_at
   where target_connection.id = p_connection_id;

  insert into integrations.provider_connection_lifecycle_events (
    event_id, connection_id, workspace_id, install_generation, provider,
    event_type, from_status, to_status, version_before, version_after,
    reason, occurred_at
  ) values (
    gen_random_uuid(), p_connection_id, p_workspace_id, p_install_generation,
    p_provider, 'account_selection_cancelled', 'pending_account_selection',
    'disconnected', current_connection.connection_version,
    current_connection.connection_version + 1,
    'merchant_cancelled_account_selection', p_cancelled_at
  );

  delete from integrations.provider_credential_envelopes as credential
   where credential.id = current_connection.credential_id;

  return query
    select connection.id, connection.lifecycle_status,
           connection.connection_version
      from integrations.provider_connections as connection
     where connection.id = p_connection_id;
end
$function$;

revoke all on function integrations.stage_provider_account_selection(
  uuid, uuid, bigint, text, uuid, text[], timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.complete_pending_provider_account_selection(
  uuid, uuid, bigint, text, bigint, jsonb, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.cancel_pending_provider_account_selection(
  uuid, uuid, bigint, text, bigint, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;

grant execute on function integrations.stage_provider_account_selection(
  uuid, uuid, bigint, text, uuid, text[], timestamptz
) to adstable_runtime;
grant execute on function integrations.complete_pending_provider_account_selection(
  uuid, uuid, bigint, text, bigint, jsonb, timestamptz
) to adstable_runtime;
grant execute on function integrations.cancel_pending_provider_account_selection(
  uuid, uuid, bigint, text, bigint, timestamptz
) to adstable_runtime;

reset role;

commit;
