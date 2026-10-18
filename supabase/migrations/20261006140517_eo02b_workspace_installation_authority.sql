begin;

set local role adstable_owner;

create table app.workspaces (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint workspaces_timestamp_order check (updated_at >= created_at)
);

create table shopify.installations (
  id bigint generated always as identity primary key,
  shop_id text not null
    check (shop_id ~ '^gid://shopify/Shop/[1-9][0-9]*$'),
  shop_domain text not null
    check (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  workspace_id uuid not null
    references app.workspaces(id) on update restrict on delete restrict,
  install_generation bigint not null default 1 check (install_generation > 0),
  status text not null default 'active'
    check (status in ('active', 'uninstall_pending_redaction', 'deletion_pending', 'deleted')),
  installed_at timestamptz not null default statement_timestamp(),
  last_verified_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint installations_shop_generation_unique unique (shop_id, install_generation),
  constraint installations_workspace_unique unique (workspace_id),
  constraint installations_timestamp_order check (
    last_verified_at >= installed_at and updated_at >= installed_at
  )
);

create unique index installations_single_live_shop_idx
  on shopify.installations (shop_id)
  where status in ('active', 'uninstall_pending_redaction', 'deletion_pending');

create index installations_shop_domain_idx
  on shopify.installations (shop_domain);

create table shopify.installation_domain_history (
  id bigint generated always as identity primary key,
  installation_id bigint not null
    references shopify.installations(id) on update restrict on delete restrict,
  previous_shop_domain text not null
    check (previous_shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  replacement_shop_domain text not null
    check (replacement_shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  changed_at timestamptz not null,
  constraint installation_domain_changed check (
    previous_shop_domain <> replacement_shop_domain
  ),
  constraint installation_domain_history_unique unique (
    installation_id, previous_shop_domain, replacement_shop_domain, changed_at
  )
);

create index installation_domain_history_installation_idx
  on shopify.installation_domain_history (installation_id);

alter table app.workspaces enable row level security;
alter table app.workspaces force row level security;
alter table shopify.installations enable row level security;
alter table shopify.installations force row level security;
alter table shopify.installation_domain_history enable row level security;
alter table shopify.installation_domain_history force row level security;

create policy workspaces_owner_all
  on app.workspaces
  for all
  to adstable_owner
  using (true)
  with check (true);

create policy installations_owner_all
  on shopify.installations
  for all
  to adstable_owner
  using (true)
  with check (true);

create policy installation_domain_history_owner_all
  on shopify.installation_domain_history
  for all
  to adstable_owner
  using (true)
  with check (true);

revoke all on table app.workspaces from public, anon, authenticated, service_role, adstable_runtime;
revoke all on table shopify.installations from public, anon, authenticated, service_role, adstable_runtime;
revoke all on table shopify.installation_domain_history from public, anon, authenticated, service_role, adstable_runtime;
revoke all on sequence shopify.installations_id_seq from public, anon, authenticated, service_role, adstable_runtime;
revoke all on sequence shopify.installation_domain_history_id_seq from public, anon, authenticated, service_role, adstable_runtime;

create or replace function shopify.bootstrap_installation(
  p_shop_id text,
  p_shop_domain text,
  p_verified_at timestamptz
)
returns table (
  workspace_id uuid,
  install_generation bigint,
  installation_status text,
  disposition text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_installation shopify.installations%rowtype;
  created_workspace_id uuid;
begin
  if p_shop_id is null
     or p_shop_id !~ '^gid://shopify/Shop/[1-9][0-9]*$'
     or p_shop_domain is null
     or p_shop_domain !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
     or p_verified_at is null
     or p_verified_at > statement_timestamp() + interval '1 minute' then
    raise exception 'INVALID_VERIFIED_SHOP_IDENTITY';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shopify-install:' || p_shop_id, 0)
  );

  select installation.*
    into existing_installation
    from shopify.installations as installation
   where installation.shop_id = p_shop_id
     and installation.status in ('active', 'uninstall_pending_redaction', 'deletion_pending')
   order by installation.install_generation desc
   limit 1
   for update;

  if found then
    if existing_installation.status <> 'active' then
      raise exception 'INSTALLATION_LIFECYCLE_REQUIRES_EO02D';
    end if;

    if p_verified_at < existing_installation.last_verified_at then
      raise exception 'STALE_SHOP_VERIFICATION';
    end if;

    if existing_installation.shop_domain <> p_shop_domain then
      insert into shopify.installation_domain_history (
        installation_id,
        previous_shop_domain,
        replacement_shop_domain,
        changed_at
      ) values (
        existing_installation.id,
        existing_installation.shop_domain,
        p_shop_domain,
        p_verified_at
      );
    end if;

    update shopify.installations as installation
       set shop_domain = p_shop_domain,
           last_verified_at = p_verified_at,
           updated_at = statement_timestamp()
     where installation.id = existing_installation.id;

    return query
      select existing_installation.workspace_id,
             existing_installation.install_generation,
             'active'::text,
             'existing'::text;
    return;
  end if;

  if exists (
    select 1
      from shopify.installations as installation
     where installation.shop_id = p_shop_id
  ) then
    raise exception 'NEW_GENERATION_REQUIRES_EO02D';
  end if;

  insert into app.workspaces (status)
  values ('active')
  returning id into created_workspace_id;

  insert into shopify.installations (
    shop_id,
    shop_domain,
    workspace_id,
    install_generation,
    status,
    installed_at,
    last_verified_at,
    updated_at
  ) values (
    p_shop_id,
    p_shop_domain,
    created_workspace_id,
    1,
    'active',
    p_verified_at,
    p_verified_at,
    statement_timestamp()
  );

  return query
    select created_workspace_id, 1::bigint, 'active'::text, 'created'::text;
end
$function$;

create or replace function shopify.resolve_active_installation(
  p_shop_id text,
  p_shop_domain text
)
returns table (
  workspace_id uuid,
  install_generation bigint,
  installation_status text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select installation.workspace_id,
         installation.install_generation,
         installation.status
    from shopify.installations as installation
   where installation.shop_id = p_shop_id
     and installation.shop_domain = p_shop_domain
     and installation.status = 'active'
$function$;

revoke all on function shopify.bootstrap_installation(text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function shopify.resolve_active_installation(text, text)
  from public, anon, authenticated, service_role;

grant execute on function shopify.bootstrap_installation(text, text, timestamptz)
  to adstable_runtime;
grant execute on function shopify.resolve_active_installation(text, text)
  to adstable_runtime;

comment on table app.workspaces is
  'Canonical AdsTable tenant registry. Browser-supplied tenant identity is never authoritative.';
comment on table shopify.installations is
  'Verified Shopify shop binding and immutable install generation authority. Token material is intentionally excluded from EO-02-B.';
comment on function shopify.bootstrap_installation(text, text, timestamptz) is
  'Creates the first workspace/install generation or idempotently verifies the active generation. Later lifecycle transitions belong to EO-02-D.';

reset role;

commit;
