begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role ads_table_owner;

create table integrations.provider_connections (
  id uuid primary key,
  installation_id bigint not null
    references shopify.installations(id) on update restrict on delete cascade,
  workspace_id uuid not null
    references app.workspaces(id) on update restrict on delete restrict,
  install_generation bigint not null check (install_generation > 0),
  provider text not null check (provider in ('meta', 'google_ads', 'klaviyo')),
  credential_id uuid not null
    references integrations.provider_credential_envelopes(id)
    on update restrict on delete restrict,
  granted_scopes text[] not null check (cardinality(granted_scopes) > 0),
  connected_at timestamptz not null,
  last_verified_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint provider_connections_authority_unique
    unique (workspace_id, install_generation, provider),
  constraint provider_connections_credential_unique unique (credential_id),
  constraint provider_connections_identity_unique
    unique (id, workspace_id, install_generation, provider),
  constraint provider_connections_timestamp_order check (
    last_verified_at >= connected_at
    and updated_at >= created_at
  )
);

create index provider_connections_installation_fk_idx
  on integrations.provider_connections (installation_id);

create table integrations.provider_accounts (
  id bigint generated always as identity primary key,
  connection_id uuid not null,
  workspace_id uuid not null,
  install_generation bigint not null check (install_generation > 0),
  provider text not null check (provider in ('meta', 'google_ads', 'klaviyo')),
  provider_account_id text not null
    check (provider_account_id = btrim(provider_account_id)
      and length(provider_account_id) between 1 and 255),
  display_name text not null
    check (display_name = btrim(display_name)
      and length(display_name) between 1 and 255),
  account_kind text not null
    check (account_kind in ('advertiser', 'manager', 'account')),
  reporting_eligible boolean not null,
  provider_status text
    check (
      provider_status is null
      or (
        provider_status = btrim(provider_status)
        and length(provider_status) between 1 and 100
      )
    ),
  currency_code text
    check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  timezone_name text
    check (timezone_name is null or length(timezone_name) between 1 and 100),
  login_account_id text
    check (
      login_account_id is null
      or (
        login_account_id = btrim(login_account_id)
        and length(login_account_id) between 1 and 255
      )
    ),
  verified_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint provider_accounts_connection_fk
    foreign key (connection_id, workspace_id, install_generation, provider)
    references integrations.provider_connections (
      id, workspace_id, install_generation, provider
    ) on update restrict on delete cascade,
  constraint provider_accounts_connection_account_unique
    unique (connection_id, provider_account_id),
  constraint provider_accounts_binding_identity_unique
    unique (
      id, connection_id, workspace_id, install_generation, provider
    ),
  constraint provider_accounts_timestamp_order check (updated_at >= created_at)
);

create index provider_accounts_connection_fk_idx
  on integrations.provider_accounts (connection_id);
create index provider_accounts_workspace_provider_idx
  on integrations.provider_accounts (
    workspace_id, install_generation, provider, provider_account_id
  );

create table integrations.reporting_account_bindings (
  id bigint generated always as identity primary key,
  connection_id uuid not null,
  account_id bigint not null,
  workspace_id uuid not null,
  install_generation bigint not null check (install_generation > 0),
  provider text not null check (provider in ('meta', 'google_ads')),
  effective_from timestamptz not null,
  effective_to timestamptz,
  change_reason text not null
    check (change_reason in ('initial_selection', 'merchant_selection')),
  created_at timestamptz not null default statement_timestamp(),
  constraint reporting_account_bindings_account_fk
    foreign key (
      account_id, connection_id, workspace_id, install_generation, provider
    )
    references integrations.provider_accounts (
      id, connection_id, workspace_id, install_generation, provider
    ) on update restrict on delete cascade,
  constraint reporting_account_bindings_period check (
    effective_to is null or effective_to > effective_from
  )
);

create index reporting_account_bindings_account_fk_idx
  on integrations.reporting_account_bindings (account_id);
create index reporting_account_bindings_connection_history_idx
  on integrations.reporting_account_bindings (
    connection_id, effective_from desc
  );
create unique index reporting_account_bindings_one_active_idx
  on integrations.reporting_account_bindings (connection_id)
  where effective_to is null;

alter table integrations.provider_connections enable row level security;
alter table integrations.provider_connections force row level security;
alter table integrations.provider_accounts enable row level security;
alter table integrations.provider_accounts force row level security;
alter table integrations.reporting_account_bindings enable row level security;
alter table integrations.reporting_account_bindings force row level security;

revoke all on table integrations.provider_connections
  from public, anon, authenticated, service_role, adstable_runtime;
revoke all on table integrations.provider_accounts
  from public, anon, authenticated, service_role, adstable_runtime;
revoke all on table integrations.reporting_account_bindings
  from public, anon, authenticated, service_role, adstable_runtime;
revoke all on sequence integrations.provider_accounts_id_seq
  from public, anon, authenticated, service_role, adstable_runtime;
revoke all on sequence integrations.reporting_account_bindings_id_seq
  from public, anon, authenticated, service_role, adstable_runtime;

create or replace function integrations.establish_provider_account_authority(
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_credential_id uuid,
  p_granted_scopes text[],
  p_accounts jsonb,
  p_reporting_account_id text,
  p_verified_at timestamptz
)
returns table (
  connection_id uuid,
  connected_account_count smallint,
  reporting_account_id text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_installation shopify.installations%rowtype;
  selected_account_count integer;
  reporting_row_id bigint;
begin
  if p_connection_id is null
     or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads', 'klaviyo')
     or p_credential_id is null
     or p_granted_scopes is null or cardinality(p_granted_scopes) < 1
     or exists (
       select 1 from unnest(p_granted_scopes) as scope(value)
       where value is null
          or value <> btrim(value)
          or length(value) < 1
          or length(value) > 200
     )
     or p_accounts is null
     or jsonb_typeof(p_accounts) <> 'array'
     or p_verified_at is null
     or p_verified_at < statement_timestamp() - interval '10 minutes'
     or p_verified_at > statement_timestamp() + interval '1 minute' then
    raise exception 'INVALID_PROVIDER_ACCOUNT_AUTHORITY';
  end if;

  selected_account_count := jsonb_array_length(p_accounts);
  if selected_account_count < 1 or selected_account_count > 3 then
    raise exception 'CONNECTED_ACCOUNT_CARDINALITY_INVALID';
  end if;

  if p_provider = 'klaviyo' then
    if selected_account_count <> 1 or p_reporting_account_id is not null then
      raise exception 'KLAVIYO_SINGLE_CONNECTED_ACCOUNT_REQUIRED';
    end if;
  elsif p_reporting_account_id is null
     or p_reporting_account_id <> btrim(p_reporting_account_id) then
    raise exception 'REPORTING_ACCOUNT_REQUIRED';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_accounts) as item(value)
     where jsonb_typeof(item.value) <> 'object'
        or item.value ?| array[
          'credential_id', 'workspace_id', 'install_generation',
          'access_token', 'refresh_token', 'token'
        ]
        or not (item.value ? 'id')
        or not (item.value ? 'name')
        or not (item.value ? 'kind')
        or not (item.value ? 'reporting_eligible')
        or jsonb_typeof(item.value -> 'id') <> 'string'
        or jsonb_typeof(item.value -> 'name') <> 'string'
        or jsonb_typeof(item.value -> 'kind') <> 'string'
        or jsonb_typeof(item.value -> 'reporting_eligible') <> 'boolean'
        or length(btrim(item.value ->> 'id')) < 1
        or length(btrim(item.value ->> 'id')) > 255
        or length(btrim(item.value ->> 'name')) < 1
        or length(btrim(item.value ->> 'name')) > 255
        or item.value ->> 'kind' not in ('advertiser', 'manager', 'account')
        or (
          item.value ? 'status'
          and (
            jsonb_typeof(item.value -> 'status') <> 'string'
            or item.value ->> 'status' <> btrim(item.value ->> 'status')
            or length(item.value ->> 'status') not between 1 and 100
          )
        )
        or (
          item.value ? 'currency'
          and (
            jsonb_typeof(item.value -> 'currency') <> 'string'
            or item.value ->> 'currency' !~ '^[A-Z]{3}$'
          )
        )
        or (
          item.value ? 'timezone'
          and (
            jsonb_typeof(item.value -> 'timezone') <> 'string'
            or length(item.value ->> 'timezone') not between 1 and 100
          )
        )
        or (
          item.value ? 'login_account_id'
          and (
            jsonb_typeof(item.value -> 'login_account_id') <> 'string'
            or length(btrim(item.value ->> 'login_account_id')) not between 1 and 255
          )
        )
  ) then
    raise exception 'PROVIDER_ACCOUNT_EVIDENCE_INVALID';
  end if;

  if (
    select count(distinct item.value ->> 'id')
      from jsonb_array_elements(p_accounts) as item(value)
  ) <> selected_account_count then
    raise exception 'PROVIDER_ACCOUNT_DUPLICATE';
  end if;

  if p_provider = 'klaviyo' and exists (
    select 1
      from jsonb_array_elements(p_accounts) as item(value)
     where item.value ->> 'kind' <> 'account'
        or (item.value ->> 'reporting_eligible')::boolean is not true
  ) then
    raise exception 'KLAVIYO_ACCOUNT_EVIDENCE_INVALID';
  end if;

  if p_provider = 'meta' and exists (
    select 1
      from jsonb_array_elements(p_accounts) as item(value)
     where item.value ->> 'kind' <> 'advertiser'
  ) then
    raise exception 'META_AD_ACCOUNT_EVIDENCE_INVALID';
  end if;

  if p_provider = 'google_ads' and exists (
    select 1
      from jsonb_array_elements(p_accounts) as item(value)
     where item.value ->> 'kind' = 'manager'
       and (item.value ->> 'reporting_eligible')::boolean
  ) then
    raise exception 'GOOGLE_MANAGER_REPORTING_ELIGIBILITY_INVALID';
  end if;

  if p_provider in ('meta', 'google_ads') and not exists (
    select 1
      from jsonb_array_elements(p_accounts) as item(value)
     where item.value ->> 'id' = p_reporting_account_id
       and item.value ->> 'kind' = 'advertiser'
       and (item.value ->> 'reporting_eligible')::boolean is true
  ) then
    raise exception 'REPORTING_ACCOUNT_NOT_VERIFIED_OR_INELIGIBLE';
  end if;

  select installation.* into current_installation
    from shopify.installations as installation
   where installation.workspace_id = p_workspace_id
     and installation.install_generation = p_install_generation
     and installation.status = 'active'
   for share;

  if not found then
    raise exception 'ACTIVE_INSTALLATION_AUTHORITY_REQUIRED';
  end if;

  if not exists (
    select 1
      from integrations.provider_credential_envelopes as credential
     where credential.id = p_credential_id
       and credential.installation_id = current_installation.id
       and credential.workspace_id = p_workspace_id
       and credential.install_generation = p_install_generation
       and credential.provider = p_provider
       and credential.purpose = 'provider_token_set'
  ) then
    raise exception 'PROVIDER_CREDENTIAL_AUTHORITY_MISMATCH';
  end if;

  if exists (
    select 1
      from integrations.provider_connections as connection
     where connection.workspace_id = p_workspace_id
       and connection.install_generation = p_install_generation
       and connection.provider = p_provider
  ) then
    raise exception 'PROVIDER_CONNECTION_ALREADY_EXISTS_USE_LIFECYCLE';
  end if;

  insert into integrations.provider_connections (
    id, installation_id, workspace_id, install_generation, provider,
    credential_id, granted_scopes, connected_at, last_verified_at,
    created_at, updated_at
  ) values (
    p_connection_id, current_installation.id, current_installation.workspace_id,
    current_installation.install_generation, p_provider, p_credential_id,
    (select array_agg(distinct scope.value order by scope.value)
       from unnest(p_granted_scopes) as scope(value)),
    p_verified_at, p_verified_at, p_verified_at, p_verified_at
  );

  insert into integrations.provider_accounts (
    connection_id, workspace_id, install_generation, provider,
    provider_account_id, display_name, account_kind, reporting_eligible,
    provider_status, currency_code, timezone_name, login_account_id,
    verified_at, created_at, updated_at
  )
  select
    p_connection_id, p_workspace_id, p_install_generation, p_provider,
    item.value ->> 'id', item.value ->> 'name', item.value ->> 'kind',
    (item.value ->> 'reporting_eligible')::boolean,
    nullif(item.value ->> 'status', ''),
    nullif(item.value ->> 'currency', ''),
    nullif(item.value ->> 'timezone', ''),
    nullif(item.value ->> 'login_account_id', ''),
    p_verified_at, p_verified_at, p_verified_at
  from jsonb_array_elements(p_accounts) as item(value);

  if p_provider in ('meta', 'google_ads') then
    select account.id into reporting_row_id
      from integrations.provider_accounts as account
     where account.connection_id = p_connection_id
       and account.provider_account_id = p_reporting_account_id
       and account.reporting_eligible
     for share;

    insert into integrations.reporting_account_bindings (
      connection_id, account_id, workspace_id, install_generation, provider,
      effective_from, change_reason, created_at
    ) values (
      p_connection_id, reporting_row_id, p_workspace_id, p_install_generation,
      p_provider, p_verified_at, 'initial_selection', p_verified_at
    );
  end if;

  return query
    select p_connection_id, selected_account_count::smallint,
           p_reporting_account_id;
end
$function$;

create or replace function integrations.select_reporting_account(
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_provider_account_id text,
  p_verified_at timestamptz
)
returns table (
  connection_id uuid,
  reporting_account_id text,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_connection integrations.provider_connections%rowtype;
  target_account integrations.provider_accounts%rowtype;
  current_binding integrations.reporting_account_bindings%rowtype;
begin
  if p_connection_id is null
     or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads')
     or p_provider_account_id is null
     or p_provider_account_id <> btrim(p_provider_account_id)
     or length(p_provider_account_id) < 1
     or p_verified_at is null
     or p_verified_at < statement_timestamp() - interval '10 minutes'
     or p_verified_at > statement_timestamp() + interval '1 minute' then
    raise exception 'INVALID_REPORTING_ACCOUNT_SELECTION';
  end if;

  select connection.* into current_connection
    from integrations.provider_connections as connection
    join shopify.installations as installation
      on installation.id = connection.installation_id
   where connection.id = p_connection_id
     and connection.workspace_id = p_workspace_id
     and connection.install_generation = p_install_generation
     and connection.provider = p_provider
     and installation.workspace_id = connection.workspace_id
     and installation.install_generation = connection.install_generation
     and installation.status = 'active'
   for update of connection;

  if not found then
    raise exception 'ACTIVE_PROVIDER_CONNECTION_REQUIRED';
  end if;

  select account.* into target_account
    from integrations.provider_accounts as account
   where account.connection_id = p_connection_id
     and account.workspace_id = p_workspace_id
     and account.install_generation = p_install_generation
     and account.provider = p_provider
     and account.provider_account_id = p_provider_account_id
     and account.account_kind = 'advertiser'
     and account.reporting_eligible
   for update;

  if not found then
    raise exception 'REPORTING_ACCOUNT_NOT_CONNECTED_OR_INELIGIBLE';
  end if;

  select binding.* into current_binding
    from integrations.reporting_account_bindings as binding
   where binding.connection_id = p_connection_id
     and binding.effective_to is null
   for update;

  if not found then
    raise exception 'ACTIVE_REPORTING_ACCOUNT_BINDING_REQUIRED';
  end if;

  if p_verified_at < current_connection.last_verified_at
     or p_verified_at < current_binding.effective_from then
    raise exception 'STALE_PROVIDER_ACCOUNT_VERIFICATION';
  end if;

  update integrations.provider_accounts
     set verified_at = p_verified_at,
         updated_at = p_verified_at
   where id = target_account.id;

  update integrations.provider_connections
     set last_verified_at = p_verified_at,
         updated_at = p_verified_at
   where id = current_connection.id;

  if current_binding.account_id = target_account.id then
    return query
      select p_connection_id, p_provider_account_id, false;
    return;
  end if;

  update integrations.reporting_account_bindings
     set effective_to = p_verified_at
   where id = current_binding.id;

  insert into integrations.reporting_account_bindings (
    connection_id, account_id, workspace_id, install_generation, provider,
    effective_from, change_reason, created_at
  ) values (
    p_connection_id, target_account.id, p_workspace_id, p_install_generation,
    p_provider, p_verified_at, 'merchant_selection', p_verified_at
  );

  return query
    select p_connection_id, p_provider_account_id, true;
end
$function$;

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
    )
  from integrations.provider_connections as connection
  join shopify.installations as installation
    on installation.id = connection.installation_id
  where connection.workspace_id = p_workspace_id
    and connection.install_generation = p_install_generation
    and connection.provider = p_provider
    and installation.workspace_id = connection.workspace_id
    and installation.install_generation = connection.install_generation
    and installation.status = 'active';
$function$;

revoke all on function integrations.establish_provider_account_authority(
  uuid, uuid, bigint, text, uuid, text[], jsonb, text, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.select_reporting_account(
  uuid, uuid, bigint, text, text, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.load_provider_account_authority(
  uuid, bigint, text
) from public, anon, authenticated, service_role, adstable_runtime;

grant execute on function integrations.establish_provider_account_authority(
  uuid, uuid, bigint, text, uuid, text[], jsonb, text, timestamptz
) to adstable_runtime;
grant execute on function integrations.select_reporting_account(
  uuid, uuid, bigint, text, text, timestamptz
) to adstable_runtime;
grant execute on function integrations.load_provider_account_authority(
  uuid, bigint, text
) to adstable_runtime;

comment on table integrations.provider_connections is
  'EO-03-C canonical provider connection authority bound to one active Shopify installation generation.';
comment on table integrations.provider_accounts is
  'EO-03-C provider-verified connected accounts only; never a merchant-entered account identifier.';
comment on table integrations.reporting_account_bindings is
  'EO-03-C effective-dated Meta/Google Reporting Account history. No Reporting Store authority exists.';

reset role;

commit;
