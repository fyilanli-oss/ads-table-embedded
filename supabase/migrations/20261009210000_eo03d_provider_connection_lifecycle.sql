begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

alter table integrations.provider_connections
  alter column credential_id drop not null,
  add column lifecycle_status text not null default 'connected'
    check (lifecycle_status in (
      'connected', 'reauthorization_required',
      'disconnect_pending', 'disconnected'
    )),
  add column connection_version bigint not null default 1
    check (connection_version > 0),
  add column lifecycle_changed_at timestamptz not null
    default statement_timestamp(),
  add column last_renewed_at timestamptz,
  add column disconnected_at timestamptz,
  add column disconnect_reason text
    check (
      disconnect_reason is null
      or (
        disconnect_reason = btrim(disconnect_reason)
        and length(disconnect_reason) between 1 and 200
      )
    ),
  add constraint provider_connections_lifecycle_shape check (
    (
      lifecycle_status in (
        'connected', 'reauthorization_required', 'disconnect_pending'
      )
      and credential_id is not null
      and disconnected_at is null
    )
    or (
      lifecycle_status = 'disconnected'
      and credential_id is null
      and disconnected_at is not null
    )
  );

alter table integrations.provider_accounts
  add column active boolean not null default true,
  add column disconnected_at timestamptz;

alter table integrations.reporting_account_bindings
  drop constraint reporting_account_bindings_change_reason_check,
  add constraint reporting_account_bindings_change_reason_check
    check (change_reason in (
      'initial_selection', 'merchant_selection', 'reconnect_selection'
    ));

create table integrations.provider_connection_lifecycle_events (
  event_id uuid primary key,
  connection_id uuid not null,
  workspace_id uuid not null,
  install_generation bigint not null check (install_generation > 0),
  provider text not null check (provider in ('meta', 'google_ads', 'klaviyo')),
  event_type text not null check (event_type in (
    'credential_renewed', 'reauthorization_required',
    'disconnect_requested', 'disconnect_finalized', 'reconnected'
  )),
  from_status text not null,
  to_status text not null,
  version_before bigint not null check (version_before > 0),
  version_after bigint not null check (version_after > version_before),
  reason text,
  outcome text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint provider_connection_lifecycle_events_connection_fk
    foreign key (connection_id, workspace_id, install_generation, provider)
    references integrations.provider_connections (
      id, workspace_id, install_generation, provider
    ) on update restrict on delete cascade
);

create index provider_connection_lifecycle_events_connection_fk_idx
  on integrations.provider_connection_lifecycle_events (
    connection_id, workspace_id, install_generation, provider
  );
create index provider_connection_lifecycle_events_history_idx
  on integrations.provider_connection_lifecycle_events (
    connection_id, occurred_at desc
  );

alter table integrations.provider_connection_lifecycle_events
  enable row level security;
alter table integrations.provider_connection_lifecycle_events
  force row level security;

create policy provider_connection_lifecycle_events_owner_all
  on integrations.provider_connection_lifecycle_events
  for all to adstable_owner using (true) with check (true);

revoke all on table integrations.provider_connection_lifecycle_events
  from public, anon, authenticated, service_role, adstable_runtime;

create or replace function integrations.load_provider_account_authority(
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text
)
returns table (
  connection_id uuid,
  credential_id uuid,
  granted_scopes text[],
  connected_at timestamptz,
  last_verified_at timestamptz,
  accounts jsonb,
  reporting_account_id text
)
language sql
security definer
set search_path = ''
as $function$
  select
    connection.id,
    connection.credential_id,
    connection.granted_scopes,
    connection.connected_at,
    connection.last_verified_at,
    coalesce(
      (
        select jsonb_agg(
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
        )
        from integrations.provider_accounts as account
        where account.connection_id = connection.id
          and account.active
      ),
      '[]'::jsonb
    ),
    (
      select account.provider_account_id
        from integrations.reporting_account_bindings as binding
        join integrations.provider_accounts as account
          on account.id = binding.account_id
       where binding.connection_id = connection.id
         and binding.effective_to is null
         and account.active
    )
  from integrations.provider_connections as connection
  join shopify.installations as installation
    on installation.id = connection.installation_id
  where connection.workspace_id = p_workspace_id
    and connection.install_generation = p_install_generation
    and connection.provider = p_provider
    and connection.lifecycle_status = 'connected'
    and connection.credential_id is not null
    and installation.workspace_id = connection.workspace_id
    and installation.install_generation = connection.install_generation
    and installation.status = 'active';
$function$;

create or replace function integrations.load_provider_connection_lifecycle(
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text
)
returns table (
  connection_id uuid,
  lifecycle_status text,
  connection_version bigint,
  credential_id uuid,
  lifecycle_changed_at timestamptz,
  disconnected_at timestamptz,
  disconnect_reason text
)
language sql
security definer
set search_path = ''
as $function$
  select
    connection.id, connection.lifecycle_status, connection.connection_version,
    connection.credential_id, connection.lifecycle_changed_at,
    connection.disconnected_at, connection.disconnect_reason
  from integrations.provider_connections as connection
  join shopify.installations as installation
    on installation.id = connection.installation_id
  where connection.id = p_connection_id
    and connection.workspace_id = p_workspace_id
    and connection.install_generation = p_install_generation
    and connection.provider = p_provider
    and installation.workspace_id = connection.workspace_id
    and installation.install_generation = connection.install_generation
    and installation.status = 'active';
$function$;

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
    select 1 from integrations.provider_connection_lifecycle_events
     where event_id = p_event_id
       and (
         connection_id <> p_connection_id
         or workspace_id <> p_workspace_id
         or install_generation <> p_install_generation
         or provider <> p_provider
         or event_type <> p_event_type
       )
  ) then
    raise exception 'LIFECYCLE_EVENT_ID_REUSE_MISMATCH';
  end if;

  if exists (
    select 1 from integrations.provider_connection_lifecycle_events
     where event_id = p_event_id
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
    select 1 from integrations.provider_connection_lifecycle_events
     where event_id = p_event_id
       and (
         connection_id <> p_connection_id
         or workspace_id <> p_workspace_id
         or install_generation <> p_install_generation
         or provider <> p_provider
         or event_type <> 'credential_renewed'
       )
  ) then raise exception 'LIFECYCLE_EVENT_ID_REUSE_MISMATCH'; end if;

  if exists (
    select 1 from integrations.provider_connection_lifecycle_events
     where event_id = p_event_id
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
    select 1 from integrations.provider_connection_lifecycle_events
     where event_id = p_event_id
       and (
         connection_id <> p_connection_id
         or event_type <> 'disconnect_finalized'
       )
  ) then raise exception 'LIFECYCLE_EVENT_ID_REUSE_MISMATCH'; end if;

  if exists (
    select 1 from integrations.provider_connection_lifecycle_events
     where event_id = p_event_id
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

revoke all on function integrations.load_provider_connection_lifecycle(
  uuid, uuid, bigint, text
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.transition_provider_connection_lifecycle(
  uuid, uuid, uuid, bigint, text, bigint, text, text, text, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.renew_provider_connection_credential(
  uuid, uuid, uuid, bigint, text, bigint, uuid, uuid, text[], timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.finalize_provider_disconnect(
  uuid, uuid, uuid, bigint, text, bigint, text, text, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;

grant execute on function integrations.load_provider_connection_lifecycle(
  uuid, uuid, bigint, text
) to adstable_runtime;
grant execute on function integrations.transition_provider_connection_lifecycle(
  uuid, uuid, uuid, bigint, text, bigint, text, text, text, timestamptz
) to adstable_runtime;
grant execute on function integrations.renew_provider_connection_credential(
  uuid, uuid, uuid, bigint, text, bigint, uuid, uuid, text[], timestamptz
) to adstable_runtime;
grant execute on function integrations.finalize_provider_disconnect(
  uuid, uuid, uuid, bigint, text, bigint, text, text, timestamptz
) to adstable_runtime;

comment on table integrations.provider_connection_lifecycle_events is
  'EO-03-D append-only, secret-free and idempotent provider connection lifecycle evidence.';
comment on column integrations.provider_connections.lifecycle_status is
  'Only connected is reporting authority. Other lifecycle states fail closed.';

reset role;

commit;
