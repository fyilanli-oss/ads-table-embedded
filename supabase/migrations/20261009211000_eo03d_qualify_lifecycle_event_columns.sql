-- EO-03-D corrective migration: qualify lifecycle event columns that
-- conflict with RETURNS TABLE output variables in PL/pgSQL.

create or replace function integrations.transition_provider_connection_lifecycle(
  p_event_id uuid,
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_expected_version bigint,
  p_event_type text,
  p_reason text,
  p_outcome text,
  p_occurred_at timestamptz
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
  target_status text;
begin
  if p_event_id is null or p_connection_id is null or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads', 'klaviyo')
     or p_expected_version is null or p_expected_version < 1
     or p_event_type not in (
       'reauthorization_required', 'disconnect_requested'
     )
     or p_occurred_at is null then
    raise exception 'INVALID_PROVIDER_CONNECTION_TRANSITION';
  end if;

  if exists (
    select 1 from integrations.provider_connection_lifecycle_events as event
     where event.event_id = p_event_id
       and (
         event.connection_id <> p_connection_id
         or event.workspace_id <> p_workspace_id
         or event.install_generation <> p_install_generation
         or event.provider <> p_provider
         or event.event_type <> p_event_type
       )
  ) then
    raise exception 'LIFECYCLE_EVENT_ID_REUSE_MISMATCH';
  end if;

  if exists (
    select 1 from integrations.provider_connection_lifecycle_events as event
     where event.event_id = p_event_id
  ) then
    return query
      select connection.id, connection.lifecycle_status,
             connection.connection_version
        from integrations.provider_connections as connection
       where connection.id = p_connection_id;
    return;
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
  if current_connection.connection_version <> p_expected_version then
    raise exception 'PROVIDER_CONNECTION_VERSION_CONFLICT';
  end if;
  if current_connection.lifecycle_status = 'disconnected' then
    raise exception 'DISCONNECTED_CONNECTION_REQUIRES_RECONNECT';
  end if;

  target_status := case
    when p_event_type = 'reauthorization_required'
      then 'reauthorization_required'
    else 'disconnect_pending'
  end;

  update integrations.provider_connections
     set lifecycle_status = target_status,
         connection_version = connection_version + 1,
         lifecycle_changed_at = p_occurred_at,
         disconnect_reason = case
           when target_status = 'disconnect_pending' then p_reason
           else disconnect_reason
         end,
         updated_at = p_occurred_at
   where id = current_connection.id;

  insert into integrations.provider_connection_lifecycle_events (
    event_id, connection_id, workspace_id, install_generation, provider,
    event_type, from_status, to_status, version_before, version_after,
    reason, outcome, occurred_at
  ) values (
    p_event_id, current_connection.id, current_connection.workspace_id,
    current_connection.install_generation, current_connection.provider,
    p_event_type, current_connection.lifecycle_status, target_status,
    current_connection.connection_version,
    current_connection.connection_version + 1,
    p_reason, p_outcome, p_occurred_at
  );

  return query
    select connection.id, connection.lifecycle_status,
           connection.connection_version
      from integrations.provider_connections as connection
     where connection.id = current_connection.id;
end
$function$;

create or replace function integrations.renew_provider_connection_credential(
  p_event_id uuid,
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_expected_version bigint,
  p_expected_credential_id uuid,
  p_new_credential_id uuid,
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
  current_connection integrations.provider_connections%rowtype;
begin
  if p_event_id is null or p_new_credential_id is null
     or p_expected_credential_id is null
     or p_granted_scopes is null or cardinality(p_granted_scopes) < 1
     or p_verified_at is null then
    raise exception 'INVALID_PROVIDER_CREDENTIAL_RENEWAL';
  end if;

  if exists (
    select 1 from integrations.provider_connection_lifecycle_events as event
     where event.event_id = p_event_id
       and (
         event.connection_id <> p_connection_id
         or event.workspace_id <> p_workspace_id
         or event.install_generation <> p_install_generation
         or event.provider <> p_provider
         or event.event_type <> 'credential_renewed'
       )
  ) then raise exception 'LIFECYCLE_EVENT_ID_REUSE_MISMATCH'; end if;

  if exists (
    select 1 from integrations.provider_connection_lifecycle_events as event
     where event.event_id = p_event_id
  ) then
    return query
      select connection.id, connection.lifecycle_status,
             connection.connection_version, connection.credential_id
        from integrations.provider_connections as connection
       where connection.id = p_connection_id;
    return;
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
  if current_connection.lifecycle_status = 'disconnected' then
    raise exception 'DISCONNECTED_CONNECTION_REQUIRES_RECONNECT';
  end if;
  if current_connection.connection_version <> p_expected_version
     or current_connection.credential_id <> p_expected_credential_id then
    raise exception 'PROVIDER_CONNECTION_VERSION_CONFLICT';
  end if;
  if not exists (
    select 1 from integrations.provider_credential_envelopes as credential
     where credential.id = p_new_credential_id
       and credential.installation_id = current_connection.installation_id
       and credential.workspace_id = p_workspace_id
       and credential.install_generation = p_install_generation
       and credential.provider = p_provider
  ) then raise exception 'PROVIDER_CREDENTIAL_AUTHORITY_MISMATCH'; end if;

  update integrations.provider_connections
     set credential_id = p_new_credential_id,
         granted_scopes = p_granted_scopes,
         lifecycle_status = 'connected',
         connection_version = connection_version + 1,
         lifecycle_changed_at = p_verified_at,
         last_renewed_at = p_verified_at,
         last_verified_at = greatest(last_verified_at, p_verified_at),
         updated_at = p_verified_at
   where id = current_connection.id;

  insert into integrations.provider_connection_lifecycle_events (
    event_id, connection_id, workspace_id, install_generation, provider,
    event_type, from_status, to_status, version_before, version_after,
    occurred_at
  ) values (
    p_event_id, current_connection.id, current_connection.workspace_id,
    current_connection.install_generation, current_connection.provider,
    'credential_renewed', current_connection.lifecycle_status, 'connected',
    current_connection.connection_version,
    current_connection.connection_version + 1, p_verified_at
  );

  delete from integrations.provider_credential_envelopes
   where id = p_expected_credential_id;

  return query
    select connection.id, connection.lifecycle_status,
           connection.connection_version, connection.credential_id
      from integrations.provider_connections as connection
     where connection.id = current_connection.id;
end
$function$;

create or replace function integrations.finalize_provider_disconnect(
  p_event_id uuid,
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_expected_version bigint,
  p_outcome text,
  p_reason text,
  p_occurred_at timestamptz
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
  if p_outcome not in (
    'revoked', 'already_invalid', 'not_supported', 'local_authority_removed'
  ) or p_occurred_at is null then
    raise exception 'VERIFIED_DISCONNECT_OUTCOME_REQUIRED';
  end if;

  if exists (
    select 1 from integrations.provider_connection_lifecycle_events as event
     where event.event_id = p_event_id
       and (
         event.connection_id <> p_connection_id
         or event.event_type <> 'disconnect_finalized'
       )
  ) then raise exception 'LIFECYCLE_EVENT_ID_REUSE_MISMATCH'; end if;

  if exists (
    select 1 from integrations.provider_connection_lifecycle_events as event
     where event.event_id = p_event_id
  ) then
    return query
      select connection.id, connection.lifecycle_status,
             connection.connection_version
        from integrations.provider_connections as connection
       where connection.id = p_connection_id;
    return;
  end if;

  select connection.* into current_connection
    from integrations.provider_connections as connection
   where connection.id = p_connection_id
     and connection.workspace_id = p_workspace_id
     and connection.install_generation = p_install_generation
     and connection.provider = p_provider
   for update;

  if not found then raise exception 'PROVIDER_CONNECTION_NOT_FOUND'; end if;
  if current_connection.connection_version <> p_expected_version then
    raise exception 'PROVIDER_CONNECTION_VERSION_CONFLICT';
  end if;
  if current_connection.lifecycle_status <> 'disconnect_pending' then
    raise exception 'DISCONNECT_PENDING_REQUIRED';
  end if;

  update integrations.reporting_account_bindings
     set effective_to = p_occurred_at
   where connection_id = current_connection.id
     and effective_to is null;

  update integrations.provider_accounts
     set active = false,
         disconnected_at = p_occurred_at,
         updated_at = p_occurred_at
   where connection_id = current_connection.id
     and active;

  update integrations.provider_connections
     set credential_id = null,
         lifecycle_status = 'disconnected',
         connection_version = connection_version + 1,
         lifecycle_changed_at = p_occurred_at,
         disconnected_at = p_occurred_at,
         disconnect_reason = p_reason,
         updated_at = p_occurred_at
   where id = current_connection.id;

  insert into integrations.provider_connection_lifecycle_events (
    event_id, connection_id, workspace_id, install_generation, provider,
    event_type, from_status, to_status, version_before, version_after,
    reason, outcome, occurred_at
  ) values (
    p_event_id, current_connection.id, current_connection.workspace_id,
    current_connection.install_generation, current_connection.provider,
    'disconnect_finalized', current_connection.lifecycle_status, 'disconnected',
    current_connection.connection_version,
    current_connection.connection_version + 1,
    p_reason, p_outcome, p_occurred_at
  );

  delete from integrations.provider_credential_envelopes
   where id = current_connection.credential_id;

  return query
    select connection.id, connection.lifecycle_status,
           connection.connection_version
      from integrations.provider_connections as connection
     where connection.id = current_connection.id;
end
$function$;

create or replace function integrations.reconnect_provider_connection(
  p_event_id uuid,
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_expected_version bigint,
  p_credential_id uuid,
  p_granted_scopes text[],
  p_accounts jsonb,
  p_reporting_account_id text,
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
  current_connection integrations.provider_connections%rowtype;
  account_count integer;
  reporting_row_id bigint;
begin
  if p_event_id is null or p_connection_id is null or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads', 'klaviyo')
     or p_expected_version is null or p_expected_version < 1
     or p_credential_id is null
     or p_granted_scopes is null or cardinality(p_granted_scopes) < 1
     or p_accounts is null or jsonb_typeof(p_accounts) <> 'array'
     or p_verified_at is null then
    raise exception 'INVALID_PROVIDER_RECONNECT';
  end if;

  account_count := jsonb_array_length(p_accounts);
  if account_count < 1 or account_count > 3 then
    raise exception 'CONNECTED_ACCOUNT_CARDINALITY_INVALID';
  end if;
  if p_provider = 'klaviyo' then
    if account_count <> 1 or p_reporting_account_id is not null then
      raise exception 'KLAVIYO_SINGLE_CONNECTED_ACCOUNT_REQUIRED';
    end if;
  elsif p_reporting_account_id is null then
    raise exception 'REPORTING_ACCOUNT_REQUIRED';
  end if;

  if exists (
    select 1 from integrations.provider_connection_lifecycle_events as event
     where event.event_id = p_event_id
       and (
         event.connection_id <> p_connection_id
         or event.workspace_id <> p_workspace_id
         or event.install_generation <> p_install_generation
         or event.provider <> p_provider
         or event.event_type <> 'reconnected'
       )
  ) then raise exception 'LIFECYCLE_EVENT_ID_REUSE_MISMATCH'; end if;

  if exists (
    select 1 from integrations.provider_connection_lifecycle_events as event
     where event.event_id = p_event_id
  ) then
    return query
      select connection.id, connection.lifecycle_status,
             connection.connection_version, connection.credential_id
        from integrations.provider_connections as connection
       where connection.id = p_connection_id;
    return;
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
  if current_connection.connection_version <> p_expected_version then
    raise exception 'PROVIDER_CONNECTION_VERSION_CONFLICT';
  end if;
  if current_connection.lifecycle_status <> 'disconnected' then
    raise exception 'DISCONNECTED_CONNECTION_REQUIRED';
  end if;
  if not exists (
    select 1 from integrations.provider_credential_envelopes as credential
     where credential.id = p_credential_id
       and credential.installation_id = current_connection.installation_id
       and credential.workspace_id = p_workspace_id
       and credential.install_generation = p_install_generation
       and credential.provider = p_provider
  ) then raise exception 'PROVIDER_CREDENTIAL_AUTHORITY_MISMATCH'; end if;

  insert into integrations.provider_accounts (
    connection_id, workspace_id, install_generation, provider,
    provider_account_id, display_name, account_kind, reporting_eligible,
    provider_status, currency_code, timezone_name, login_account_id,
    verified_at, created_at, updated_at, active, disconnected_at
  )
  select
    p_connection_id, p_workspace_id, p_install_generation, p_provider,
    item.value ->> 'id', item.value ->> 'name', item.value ->> 'kind',
    (item.value ->> 'reporting_eligible')::boolean,
    nullif(item.value ->> 'status', ''),
    nullif(item.value ->> 'currency', ''),
    nullif(item.value ->> 'timezone', ''),
    nullif(item.value ->> 'login_account_id', ''),
    p_verified_at, p_verified_at, p_verified_at, true, null
  from jsonb_array_elements(p_accounts) as item(value)
  on conflict (connection_id, provider_account_id) do update
    set display_name = excluded.display_name,
        account_kind = excluded.account_kind,
        reporting_eligible = excluded.reporting_eligible,
        provider_status = excluded.provider_status,
        currency_code = excluded.currency_code,
        timezone_name = excluded.timezone_name,
        login_account_id = excluded.login_account_id,
        verified_at = excluded.verified_at,
        updated_at = excluded.updated_at,
        active = true,
        disconnected_at = null;

  update integrations.provider_accounts as account
     set active = false,
         disconnected_at = p_verified_at,
         updated_at = p_verified_at
   where account.connection_id = p_connection_id
     and account.active
     and not exists (
       select 1 from jsonb_array_elements(p_accounts) as item(value)
        where item.value ->> 'id' = account.provider_account_id
     );

  if p_provider in ('meta', 'google_ads') then
    select account.id into reporting_row_id
      from integrations.provider_accounts as account
     where account.connection_id = p_connection_id
       and account.provider_account_id = p_reporting_account_id
       and account.account_kind = 'advertiser'
       and account.reporting_eligible
       and account.active;

    if reporting_row_id is null then
      raise exception 'REPORTING_ACCOUNT_NOT_VERIFIED_OR_INELIGIBLE';
    end if;

    insert into integrations.reporting_account_bindings (
      connection_id, account_id, workspace_id, install_generation, provider,
      effective_from, change_reason, created_at
    ) values (
      p_connection_id, reporting_row_id, p_workspace_id, p_install_generation,
      p_provider, p_verified_at, 'reauthorization', p_verified_at
    );
  end if;

  update integrations.provider_connections
     set credential_id = p_credential_id,
         granted_scopes = p_granted_scopes,
         lifecycle_status = 'connected',
         connection_version = connection_version + 1,
         lifecycle_changed_at = p_verified_at,
         connected_at = p_verified_at,
         last_verified_at = p_verified_at,
         disconnected_at = null,
         disconnect_reason = null,
         updated_at = p_verified_at
   where id = current_connection.id;

  insert into integrations.provider_connection_lifecycle_events (
    event_id, connection_id, workspace_id, install_generation, provider,
    event_type, from_status, to_status, version_before, version_after,
    occurred_at
  ) values (
    p_event_id, current_connection.id, current_connection.workspace_id,
    current_connection.install_generation, current_connection.provider,
    'reconnected', current_connection.lifecycle_status, 'connected',
    current_connection.connection_version,
    current_connection.connection_version + 1, p_verified_at
  );

  return query
    select connection.id, connection.lifecycle_status,
           connection.connection_version, connection.credential_id
      from integrations.provider_connections as connection
     where connection.id = current_connection.id;
end
$function$;
