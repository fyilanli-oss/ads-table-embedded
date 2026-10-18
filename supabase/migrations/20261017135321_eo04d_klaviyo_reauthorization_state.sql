begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

create or replace function integrations.load_provider_connection_lifecycle_by_owner(
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
    connection.id,
    connection.lifecycle_status,
    connection.connection_version,
    connection.credential_id,
    connection.lifecycle_changed_at,
    connection.disconnected_at,
    connection.disconnect_reason
  from integrations.provider_connections as connection
  join shopify.installations as installation
    on installation.id = connection.installation_id
  where connection.workspace_id = p_workspace_id
    and connection.install_generation = p_install_generation
    and connection.provider = p_provider
    and p_provider in ('meta', 'google_ads', 'klaviyo')
    and installation.workspace_id = connection.workspace_id
    and installation.install_generation = connection.install_generation
    and installation.status = 'active';
$function$;

create or replace function integrations.load_pending_klaviyo_account_selection(
  p_workspace_id uuid,
  p_install_generation bigint
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
  select
    connection.id,
    connection.lifecycle_status,
    connection.connection_version,
    connection.credential_id,
    connection.granted_scopes
  from integrations.provider_connections as connection
  join shopify.installations as installation
    on installation.id = connection.installation_id
  where connection.workspace_id = p_workspace_id
    and connection.install_generation = p_install_generation
    and connection.provider = 'klaviyo'
    and connection.lifecycle_status = 'pending_account_selection'
    and connection.credential_id is not null
    and installation.workspace_id = connection.workspace_id
    and installation.install_generation = connection.install_generation
    and installation.status = 'active';
$function$;

revoke all on function integrations.load_provider_connection_lifecycle_by_owner(
  uuid, bigint, text
) from public, anon, authenticated, service_role, adstable_runtime;

revoke all on function integrations.load_pending_klaviyo_account_selection(
  uuid, bigint
) from public, anon, authenticated, service_role, adstable_runtime;

grant execute on function integrations.load_provider_connection_lifecycle_by_owner(
  uuid, bigint, text
) to adstable_runtime;

grant execute on function integrations.load_pending_klaviyo_account_selection(
  uuid, bigint
) to adstable_runtime;

comment on function integrations.load_provider_connection_lifecycle_by_owner(
  uuid, bigint, text
) is
  'Reads canonical local provider lifecycle state for Settings without granting reporting authority or contacting the provider.';

comment on function integrations.load_pending_klaviyo_account_selection(
  uuid, bigint
) is
  'Resumes Klaviyo account verification after initial authorization or reauthorization while preserving historical account and spend records.';

reset role;

commit;
