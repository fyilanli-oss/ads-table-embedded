-- F01-A: prepared only. Live application requires separate approval and F01-B evidence.
-- Restore the accepted canonical disconnect body; retain callback-return authority.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

lock table integrations.provider_authorization_handoffs in access exclusive mode;

do $guard$
begin
  if exists (
    select 1 from integrations.provider_authorization_handoffs
     where status not in ('consumed', 'failed', 'expired')
        or credential_id is not null
  ) then
    raise exception 'A6TECH01_HANDOFF_RETIREMENT_PRECONDITION_FAILED';
  end if;

  if to_regprocedure('shopify.resolve_active_installation_callback_return(uuid,bigint)') is null
     or not has_function_privilege(
       'adstable_runtime',
       'shopify.resolve_active_installation_callback_return(uuid,bigint)',
       'EXECUTE'
     ) then
    raise exception 'A6TECH01_CALLBACK_RETURN_AUTHORITY_REQUIRED';
  end if;
end
$guard$;

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

  update integrations.reporting_account_bindings as binding
     set effective_to = p_occurred_at
   where binding.connection_id = current_connection.id
     and binding.effective_to is null;

  update integrations.provider_accounts as account
     set active = false,
         disconnected_at = p_occurred_at,
         updated_at = p_occurred_at
   where account.connection_id = current_connection.id
     and account.active;

  update integrations.provider_connections as connection
     set credential_id = null,
         lifecycle_status = 'disconnected',
         connection_version = connection.connection_version + 1,
         lifecycle_changed_at = p_occurred_at,
         disconnected_at = p_occurred_at,
         disconnect_reason = p_reason,
         updated_at = p_occurred_at
   where connection.id = current_connection.id;

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

drop function integrations.cancel_provider_authorization_handoff(uuid, uuid, bigint, text, timestamptz) restrict;
drop function integrations.consume_provider_authorization_handoff(uuid, uuid, uuid, bigint, text, text[], jsonb, text, timestamptz, timestamptz) restrict;
drop function integrations.create_provider_authorization_handoff(uuid, uuid, bigint, text, uuid, timestamptz) restrict;
drop function integrations.expire_provider_authorization_handoffs(timestamptz, integer) restrict;
drop function integrations.load_current_provider_authorization_handoff(uuid, bigint, text, timestamptz) restrict;
drop function integrations.load_provider_authorization_handoff(uuid, uuid, bigint, text, timestamptz) restrict;

revoke all on table integrations.provider_authorization_handoffs
  from public, anon, authenticated, service_role, adstable_runtime;

drop policy provider_authorization_handoffs_owner_all
  on integrations.provider_authorization_handoffs;
create policy provider_authorization_handoffs_owner_read
  on integrations.provider_authorization_handoffs
  for select to adstable_owner using (true);

comment on table integrations.provider_authorization_handoffs is
  'Retired authorization-handoff audit history. No runtime API or credential reference remains. Historical rows and installation privacy cascades are preserved.';

reset role;

commit;
