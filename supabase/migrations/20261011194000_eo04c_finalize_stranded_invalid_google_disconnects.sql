begin;

set local role adstable_owner;

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

reset role;

commit;
