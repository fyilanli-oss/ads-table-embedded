begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

alter table integrations.klaviyo_email_spend_periods
  drop constraint if exists klaviyo_email_spend_periods_effective_start_unique;

drop index if exists integrations.klaviyo_email_spend_periods_current_idx;
create index klaviyo_email_spend_periods_current_idx
  on integrations.klaviyo_email_spend_periods (
    connection_id, effective_from desc, created_at desc, id desc
  );

create or replace function integrations.append_klaviyo_spend_period(
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_expected_version bigint,
  p_account jsonb,
  p_estimated_spend numeric,
  p_verified_at timestamptz
)
returns table (
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
  current_account integrations.provider_accounts%rowtype;
  target_period_id uuid;
  target_effective_from date;
  recorded_at timestamptz := statement_timestamp();
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
    raise exception 'INVALID_KLAVIYO_SPEND_UPDATE';
  end if;

  if p_account ?| array[
       'credential_id', 'workspace_id', 'install_generation',
       'access_token', 'refresh_token', 'token'
     ] then raise exception 'KLAVIYO_ACCOUNT_EVIDENCE_MISMATCH'; end if;

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

  if not found or current_connection.lifecycle_status <> 'connected' then
    raise exception 'CONNECTED_KLAVIYO_CONNECTION_REQUIRED';
  end if;
  if current_connection.connection_version <> p_expected_version then
    raise exception 'PROVIDER_CONNECTION_VERSION_CONFLICT';
  end if;

  select account.* into current_account
    from integrations.provider_accounts as account
   where account.connection_id = p_connection_id
     and account.active
     and account.account_kind = 'account'
     and account.reporting_eligible
   for update;

  if not found
     or p_account ->> 'id' <> current_account.provider_account_id
     or p_account ->> 'kind' is distinct from 'account'
     or p_account ->> 'reporting_eligible' is distinct from 'true'
     or coalesce(p_account ->> 'currency', '') !~ '^[A-Z]{3}$'
     or coalesce(length(btrim(p_account ->> 'name')), 0) not between 1 and 255
     or coalesce(length(p_account ->> 'timezone'), 0) not between 1 and 100
     or not exists (
       select 1 from pg_catalog.pg_timezone_names as zone
        where zone.name = p_account ->> 'timezone'
     ) then
    raise exception 'KLAVIYO_ACCOUNT_EVIDENCE_MISMATCH';
  end if;

  update integrations.provider_accounts as account
     set display_name = p_account ->> 'name',
         provider_status = nullif(p_account ->> 'status', ''),
         currency_code = p_account ->> 'currency',
         timezone_name = p_account ->> 'timezone',
         verified_at = p_verified_at,
         updated_at = recorded_at
   where account.id = current_account.id;

  target_effective_from := (
    p_verified_at at time zone (p_account ->> 'timezone')
  )::date;

  insert into integrations.klaviyo_email_spend_periods (
    connection_id, account_id, workspace_id, install_generation, provider,
    provider_account_id, source_currency, estimated_30_day_email_spend,
    effective_from, created_at, updated_at
  ) values (
    p_connection_id, current_account.id, p_workspace_id, p_install_generation,
    'klaviyo',
    current_account.provider_account_id, p_account ->> 'currency',
    p_estimated_spend, target_effective_from, recorded_at, recorded_at
  ) returning id into target_period_id;

  update integrations.provider_connections as connection
     set connection_version = connection.connection_version + 1,
         last_verified_at = p_verified_at,
         updated_at = recorded_at
   where connection.id = p_connection_id;

  return query select target_period_id, target_effective_from, 1::bigint;
end
$function$;

create or replace function integrations.correct_klaviyo_spend_period(
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_spend_period_id uuid,
  p_expected_correction_version bigint,
  p_estimated_spend numeric
)
returns table (
  spend_period_id uuid,
  effective_from date,
  correction_version bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_period integrations.klaviyo_email_spend_periods%rowtype;
begin
  if p_connection_id is null or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_spend_period_id is null
     or p_expected_correction_version is null
     or p_expected_correction_version < 1
     or p_estimated_spend is null or p_estimated_spend < 0
     or p_estimated_spend > 99999999.99
     or round(p_estimated_spend, 2) <> p_estimated_spend then
    raise exception 'INVALID_KLAVIYO_SPEND_CORRECTION';
  end if;

  if not exists (
    select 1
      from integrations.provider_connections as connection
      join shopify.installations as installation
        on installation.id = connection.installation_id
     where connection.id = p_connection_id
       and connection.workspace_id = p_workspace_id
       and connection.install_generation = p_install_generation
       and connection.provider = 'klaviyo'
       and connection.lifecycle_status = 'connected'
       and installation.status = 'active'
  ) then raise exception 'CONNECTED_KLAVIYO_CONNECTION_REQUIRED'; end if;

  select period.* into current_period
    from integrations.klaviyo_email_spend_periods as period
   where period.id = p_spend_period_id
     and period.connection_id = p_connection_id
     and period.workspace_id = p_workspace_id
     and period.install_generation = p_install_generation
   for update;

  if not found then raise exception 'SPEND_HISTORY_ENTRY_NOT_FOUND'; end if;
  if current_period.correction_version <> p_expected_correction_version then
    raise exception 'KLAVIYO_SPEND_CORRECTION_VERSION_CONFLICT';
  end if;

  update integrations.klaviyo_email_spend_periods as period
     set estimated_30_day_email_spend = p_estimated_spend,
         correction_version = period.correction_version + 1,
         updated_at = statement_timestamp()
   where period.id = current_period.id;

  return query
    select period.id, period.effective_from, period.correction_version
      from integrations.klaviyo_email_spend_periods as period
     where period.id = current_period.id;
end
$function$;

create or replace function integrations.correct_klaviyo_spend_period(
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_effective_from date,
  p_expected_correction_version bigint,
  p_estimated_spend numeric
)
returns table (
  spend_period_id uuid,
  effective_from date,
  correction_version bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_period_id uuid;
begin
  select period.id into target_period_id
    from integrations.klaviyo_email_spend_periods as period
   where period.connection_id = p_connection_id
     and period.workspace_id = p_workspace_id
     and period.install_generation = p_install_generation
     and period.effective_from = p_effective_from
   order by period.created_at desc, period.id desc
   limit 1;

  if not found then raise exception 'SPEND_HISTORY_ENTRY_NOT_FOUND'; end if;

  return query
    select * from integrations.correct_klaviyo_spend_period(
      p_connection_id,
      p_workspace_id,
      p_install_generation,
      target_period_id,
      p_expected_correction_version,
      p_estimated_spend
    );
end
$function$;

create or replace function integrations.load_klaviyo_spend_configuration(
  p_workspace_id uuid,
  p_install_generation bigint
)
returns table (
  connection_id uuid,
  connection_version bigint,
  credential_id uuid,
  account_id bigint,
  provider_account_id text,
  account_name text,
  source_currency text,
  timezone_name text,
  spend_periods jsonb
)
language sql
security definer
set search_path = ''
as $function$
  select
    connection.id,
    connection.connection_version,
    connection.credential_id,
    account.id,
    account.provider_account_id,
    account.display_name,
    account.currency_code,
    account.timezone_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', period.id,
          'amount', period.estimated_30_day_email_spend,
          'currency', period.source_currency,
          'effective_from', period.effective_from,
          'correction_version', period.correction_version,
          'created_at', period.created_at,
          'updated_at', period.updated_at
        ) order by period.effective_from desc, period.created_at desc, period.id desc
      )
      from integrations.klaviyo_email_spend_periods as period
      where period.connection_id = connection.id
        and period.account_id = account.id
    ), '[]'::jsonb)
  from integrations.provider_connections as connection
  join shopify.installations as installation
    on installation.id = connection.installation_id
  join integrations.provider_accounts as account
    on account.connection_id = connection.id
   and account.active
   and account.account_kind = 'account'
   and account.reporting_eligible
  where connection.workspace_id = p_workspace_id
    and connection.install_generation = p_install_generation
    and connection.provider = 'klaviyo'
    and connection.lifecycle_status = 'connected'
    and connection.credential_id is not null
    and installation.status = 'active';
$function$;

revoke all on function integrations.correct_klaviyo_spend_period(
  uuid, uuid, bigint, uuid, bigint, numeric
) from public, anon, authenticated, service_role, adstable_runtime;

grant execute on function integrations.correct_klaviyo_spend_period(
  uuid, uuid, bigint, uuid, bigint, numeric
) to adstable_runtime;

comment on table integrations.klaviyo_email_spend_periods is
  'Private merchant estimates of 30-day Klaviyo email spend. Every Update spend submission is an immutable event, including repeated same-day submissions; runtime access is function-only.';

reset role;

commit;
