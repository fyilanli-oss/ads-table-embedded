begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

create or replace function integrations.complete_klaviyo_setup_with_spend(
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_expected_version bigint,
  p_account jsonb,
  p_estimated_spend numeric,
  p_verified_at timestamptz
)
returns table (
  connection_id uuid,
  lifecycle_status text,
  connection_version bigint,
  spend_period_id uuid,
  effective_from date,
  correction_version bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_connection integrations.provider_connections%rowtype;
  target_account_id bigint;
  target_timezone text;
  target_effective_from date;
  target_period_id uuid;
begin
  if p_connection_id is null or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_expected_version is null or p_expected_version < 1
     or p_account is null or jsonb_typeof(p_account) <> 'object'
     or p_estimated_spend is null or p_estimated_spend < 0
     or p_estimated_spend > 99999999.99
     or round(p_estimated_spend, 2) <> p_estimated_spend
     or p_verified_at is null
     or p_verified_at < statement_timestamp() - interval '10 minutes'
     or p_verified_at > statement_timestamp() + interval '1 minute' then
    raise exception 'INVALID_KLAVIYO_SETUP_COMPLETION';
  end if;

  if p_account ?| array[
       'credential_id', 'workspace_id', 'install_generation',
       'access_token', 'refresh_token', 'token'
     ]
     or jsonb_typeof(p_account -> 'id') <> 'string'
     or jsonb_typeof(p_account -> 'name') <> 'string'
     or p_account ->> 'kind' is distinct from 'account'
     or p_account ->> 'reporting_eligible' is distinct from 'true'
     or length(btrim(p_account ->> 'id')) not between 1 and 255
     or length(btrim(p_account ->> 'name')) not between 1 and 255
     or coalesce(p_account ->> 'currency', '') !~ '^[A-Z]{3}$'
     or coalesce(length(p_account ->> 'timezone'), 0) not between 1 and 100
     or not exists (
       select 1 from pg_catalog.pg_timezone_names as zone
        where zone.name = p_account ->> 'timezone'
     ) then
    raise exception 'KLAVIYO_ACCOUNT_EVIDENCE_INVALID';
  end if;

  select connection.* into current_connection
    from integrations.provider_connections as connection
    join shopify.installations as installation
      on installation.id = connection.installation_id
   where connection.id = p_connection_id
     and connection.workspace_id = p_workspace_id
     and connection.install_generation = p_install_generation
     and connection.provider = 'klaviyo'
     and installation.status = 'active'
   for update of connection;

  if not found then raise exception 'ACTIVE_KLAVIYO_CONNECTION_REQUIRED'; end if;
  if current_connection.lifecycle_status <> 'pending_account_selection'
     or current_connection.credential_id is null then
    raise exception 'PENDING_KLAVIYO_SETUP_REQUIRED';
  end if;
  if current_connection.connection_version <> p_expected_version then
    raise exception 'PROVIDER_CONNECTION_VERSION_CONFLICT';
  end if;

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
  ) values (
    p_connection_id, p_workspace_id, p_install_generation, 'klaviyo',
    p_account ->> 'id', p_account ->> 'name', 'account', true,
    nullif(p_account ->> 'status', ''), p_account ->> 'currency',
    p_account ->> 'timezone', null, p_verified_at, p_verified_at,
    p_verified_at, true, null
  )
  on conflict on constraint provider_accounts_connection_account_unique
  do update set
    display_name = excluded.display_name,
    account_kind = 'account',
    reporting_eligible = true,
    provider_status = excluded.provider_status,
    currency_code = excluded.currency_code,
    timezone_name = excluded.timezone_name,
    login_account_id = null,
    verified_at = excluded.verified_at,
    updated_at = excluded.updated_at,
    active = true,
    disconnected_at = null
  returning id, timezone_name into target_account_id, target_timezone;

  target_effective_from := (p_verified_at at time zone target_timezone)::date;

  insert into integrations.klaviyo_email_spend_periods (
    connection_id, account_id, workspace_id, install_generation, provider,
    provider_account_id, source_currency, estimated_30_day_email_spend,
    effective_from, created_at, updated_at
  ) values (
    p_connection_id, target_account_id, p_workspace_id, p_install_generation,
    'klaviyo',
    p_account ->> 'id', p_account ->> 'currency', p_estimated_spend,
    target_effective_from, p_verified_at, p_verified_at
  ) returning id into target_period_id;

  update integrations.provider_connections as connection
     set lifecycle_status = 'connected',
         connection_version = connection.connection_version + 1,
         lifecycle_changed_at = p_verified_at,
         connected_at = p_verified_at,
         last_verified_at = p_verified_at,
         disconnected_at = null,
         disconnect_reason = null,
         updated_at = p_verified_at
   where connection.id = p_connection_id;

  insert into integrations.provider_connection_lifecycle_events (
    event_id, connection_id, workspace_id, install_generation, provider,
    event_type, from_status, to_status, version_before, version_after,
    occurred_at
  ) values (
    gen_random_uuid(), p_connection_id, p_workspace_id, p_install_generation,
    'klaviyo', 'account_selection_completed', 'pending_account_selection',
    'connected', current_connection.connection_version,
    current_connection.connection_version + 1, p_verified_at
  );

  return query
    select connection.id, connection.lifecycle_status,
           connection.connection_version, target_period_id,
           target_effective_from, 1::bigint
      from integrations.provider_connections as connection
     where connection.id = p_connection_id;
end
$function$;

revoke all on function integrations.complete_klaviyo_setup_with_spend(
  uuid, uuid, bigint, bigint, jsonb, numeric, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;

grant execute on function integrations.complete_klaviyo_setup_with_spend(
  uuid, uuid, bigint, bigint, jsonb, numeric, timestamptz
) to adstable_runtime;

reset role;

commit;
