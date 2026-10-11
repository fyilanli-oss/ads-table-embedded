begin;

set local role adstable_owner;

alter table integrations.provider_authorization_handoffs
  drop constraint provider_authorization_handoff_status_shape;

alter table integrations.provider_authorization_handoffs
  add constraint provider_authorization_handoff_status_shape
  check (
    (
      status = 'awaiting_selection'
      and credential_id is not null
      and consumed_at is null
      and failure_code is null
    )
    or (
      status = 'consumed'
      and consumed_at is not null
      and failure_code is null
    )
    or (
      status in ('expired', 'failed')
      and credential_id is null
      and consumed_at is null
      and failure_code is not null
    )
  );

do $block$
declare
  stranded record;
begin
  for stranded in
    select
      connection.id,
      connection.workspace_id,
      connection.install_generation,
      connection.provider,
      connection.connection_version,
      connection.disconnect_reason
    from integrations.provider_connections as connection
    where connection.provider = 'google_ads'
      and connection.lifecycle_status = 'disconnect_pending'
      and connection.disconnect_reason = 'google_refresh_token_invalid_or_revoked'
    for update
  loop
    perform *
      from integrations.finalize_provider_disconnect(
        gen_random_uuid(),
        stranded.id,
        stranded.workspace_id,
        stranded.install_generation,
        stranded.provider,
        stranded.connection_version,
        'already_invalid',
        stranded.disconnect_reason,
        statement_timestamp()
      );
  end loop;
end
$block$;

comment on constraint provider_authorization_handoff_status_shape
  on integrations.provider_authorization_handoffs is
  'Pending selection requires a live credential. Consumed handoff history may release its credential reference after verified disconnect; failed and expired handoffs never retain credentials.';

reset role;

commit;
