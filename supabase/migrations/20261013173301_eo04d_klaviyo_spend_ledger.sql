begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

create table integrations.klaviyo_email_spend_periods (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  account_id bigint not null,
  workspace_id uuid not null,
  install_generation bigint not null check (install_generation > 0),
  provider text not null default 'klaviyo' check (provider = 'klaviyo'),
  provider_account_id text not null,
  source_currency text not null check (source_currency ~ '^[A-Z]{3}$'),
  estimated_30_day_email_spend numeric(10, 2) not null
    check (
      estimated_30_day_email_spend >= 0
      and estimated_30_day_email_spend <= 99999999.99
    ),
  effective_from date not null,
  provenance text not null default 'user_estimated'
    check (provenance = 'user_estimated'),
  correction_version bigint not null default 1 check (correction_version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint klaviyo_email_spend_periods_account_fk
    foreign key (
      account_id, connection_id, workspace_id, install_generation, provider
    ) references integrations.provider_accounts (
      id, connection_id, workspace_id, install_generation, provider
    ) on update restrict on delete cascade,
  constraint klaviyo_email_spend_periods_account_identity check (
    provider_account_id = btrim(provider_account_id)
    and length(provider_account_id) between 1 and 255
  ),
  constraint klaviyo_email_spend_periods_effective_start_unique
    unique (connection_id, account_id, effective_from),
  constraint klaviyo_email_spend_periods_timestamp_order
    check (updated_at >= created_at)
);

create index klaviyo_email_spend_periods_account_fk_idx
  on integrations.klaviyo_email_spend_periods (
    account_id, connection_id, workspace_id, install_generation, provider
  );
create index klaviyo_email_spend_periods_current_idx
  on integrations.klaviyo_email_spend_periods (
    connection_id, effective_from desc, created_at desc
  );

alter table integrations.klaviyo_email_spend_periods enable row level security;
alter table integrations.klaviyo_email_spend_periods force row level security;

create policy klaviyo_email_spend_periods_owner_all
  on integrations.klaviyo_email_spend_periods
  for all to adstable_owner using (true) with check (true);

revoke all on table integrations.klaviyo_email_spend_periods
  from public, anon, authenticated, service_role, adstable_runtime;

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

  if exists (
    select 1 from integrations.klaviyo_email_spend_periods as period
     where period.connection_id = p_connection_id
       and period.account_id = target_account_id
       and period.effective_from = target_effective_from
  ) then raise exception 'DUPLICATE_EFFECTIVE_START'; end if;

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
         updated_at = p_verified_at
   where account.id = current_account.id;

  target_effective_from := (
    p_verified_at at time zone (p_account ->> 'timezone')
  )::date;

  if exists (
    select 1 from integrations.klaviyo_email_spend_periods as period
     where period.connection_id = p_connection_id
       and period.account_id = current_account.id
       and period.effective_from = target_effective_from
  ) then raise exception 'DUPLICATE_EFFECTIVE_START'; end if;

  insert into integrations.klaviyo_email_spend_periods (
    connection_id, account_id, workspace_id, install_generation, provider,
    provider_account_id, source_currency, estimated_30_day_email_spend,
    effective_from, created_at, updated_at
  ) values (
    p_connection_id, current_account.id, p_workspace_id, p_install_generation,
    'klaviyo',
    current_account.provider_account_id, p_account ->> 'currency',
    p_estimated_spend, target_effective_from, p_verified_at, p_verified_at
  ) returning id into target_period_id;

  update integrations.provider_connections as connection
     set connection_version = connection.connection_version + 1,
         last_verified_at = p_verified_at,
         updated_at = p_verified_at
   where connection.id = p_connection_id;

  return query select target_period_id, target_effective_from, 1::bigint;
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
  current_period integrations.klaviyo_email_spend_periods%rowtype;
begin
  if p_connection_id is null or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_effective_from is null
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
   where period.connection_id = p_connection_id
     and period.workspace_id = p_workspace_id
     and period.install_generation = p_install_generation
     and period.effective_from = p_effective_from
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
        ) order by period.effective_from desc, period.created_at desc
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

revoke all on function integrations.complete_klaviyo_setup_with_spend(
  uuid, uuid, bigint, bigint, jsonb, numeric, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.append_klaviyo_spend_period(
  uuid, uuid, bigint, bigint, jsonb, numeric, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.correct_klaviyo_spend_period(
  uuid, uuid, bigint, date, bigint, numeric
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.load_klaviyo_spend_configuration(
  uuid, bigint
) from public, anon, authenticated, service_role, adstable_runtime;

grant execute on function integrations.complete_klaviyo_setup_with_spend(
  uuid, uuid, bigint, bigint, jsonb, numeric, timestamptz
) to adstable_runtime;
grant execute on function integrations.append_klaviyo_spend_period(
  uuid, uuid, bigint, bigint, jsonb, numeric, timestamptz
) to adstable_runtime;
grant execute on function integrations.correct_klaviyo_spend_period(
  uuid, uuid, bigint, date, bigint, numeric
) to adstable_runtime;
grant execute on function integrations.load_klaviyo_spend_configuration(
  uuid, bigint
) to adstable_runtime;

comment on table integrations.klaviyo_email_spend_periods is
  'Private effective-dated merchant estimates of 30-day Klaviyo email spend. History survives provider disconnect; runtime access is function-only.';

reset role;

commit;
