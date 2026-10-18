begin;

set local role adstable_owner;

create table billing.workspace_subscriptions (
  workspace_id uuid not null
    references app.workspaces(id) on update restrict on delete restrict,
  install_generation bigint not null check (install_generation > 0),
  installation_id bigint not null
    references shopify.installations(id) on update restrict on delete restrict,
  shop_id text not null
    check (shop_id ~ '^gid://shopify/Shop/[1-9][0-9]*$'),
  shop_domain text not null
    check (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  provider text not null default 'shopify_app_pricing'
    check (provider = 'shopify_app_pricing'),
  provider_status text not null
    check (provider_status in ('active', 'no_active_subscription')),
  billing_period text,
  cancel_at_end_of_cycle boolean not null default false,
  trial_ends_at timestamptz,
  current_cycle_start timestamptz,
  current_cycle_end timestamptz,
  item_handles text[] not null default '{}'::text[],
  pending_item_handles text[] not null default '{}'::text[],
  source_observed_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (workspace_id, install_generation),
  constraint workspace_subscriptions_install_unique
    unique (installation_id, install_generation),
  constraint workspace_subscriptions_cycle_order check (
    current_cycle_start is null
    or current_cycle_end is null
    or current_cycle_end > current_cycle_start
  ),
  constraint workspace_subscriptions_shape check (
    (
      provider_status = 'no_active_subscription'
      and billing_period is null
      and trial_ends_at is null
      and current_cycle_start is null
      and current_cycle_end is null
      and cardinality(item_handles) = 0
    )
    or
    (
      provider_status = 'active'
      and billing_period is not null
      and cardinality(item_handles) > 0
    )
  )
);

create table billing.workspace_entitlements (
  workspace_id uuid not null,
  install_generation bigint not null check (install_generation > 0),
  entitlement_status text not null
    check (entitlement_status in ('trial', 'active', 'subscription_required')),
  reporting_store_limit smallint not null default 1
    check (reporting_store_limit = 1),
  candidate_detection_billed boolean not null default false
    check (candidate_detection_billed = false),
  reporting_store_switch_billed boolean not null default false
    check (reporting_store_switch_billed = false),
  source_observed_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (workspace_id, install_generation),
  foreign key (workspace_id, install_generation)
    references billing.workspace_subscriptions(workspace_id, install_generation)
    on update restrict on delete restrict
);

create table billing.trial_ledger (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  install_generation bigint not null check (install_generation > 0),
  trial_ends_at timestamptz not null,
  item_handles text[] not null,
  source_observed_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default statement_timestamp(),
  foreign key (workspace_id, install_generation)
    references billing.workspace_subscriptions(workspace_id, install_generation)
    on update restrict on delete restrict,
  constraint trial_ledger_snapshot_unique
    unique (workspace_id, install_generation, source_hash)
);

alter table billing.workspace_subscriptions enable row level security;
alter table billing.workspace_subscriptions force row level security;
alter table billing.workspace_entitlements enable row level security;
alter table billing.workspace_entitlements force row level security;
alter table billing.trial_ledger enable row level security;
alter table billing.trial_ledger force row level security;

create policy workspace_subscriptions_owner_all
  on billing.workspace_subscriptions
  for all to adstable_owner using (true) with check (true);

create policy workspace_entitlements_owner_all
  on billing.workspace_entitlements
  for all to adstable_owner using (true) with check (true);

create policy trial_ledger_owner_all
  on billing.trial_ledger
  for all to adstable_owner using (true) with check (true);

revoke all on table billing.workspace_subscriptions
  from public, anon, authenticated, service_role, adstable_runtime;
revoke all on table billing.workspace_entitlements
  from public, anon, authenticated, service_role, adstable_runtime;
revoke all on table billing.trial_ledger
  from public, anon, authenticated, service_role, adstable_runtime;
revoke all on sequence billing.trial_ledger_id_seq
  from public, anon, authenticated, service_role, adstable_runtime;

create or replace function billing.apply_shopify_app_pricing_snapshot(
  p_shop_id text,
  p_shop_domain text,
  p_install_generation bigint,
  p_provider_active boolean,
  p_entitlement_status text,
  p_billing_period text,
  p_cancel_at_end_of_cycle boolean,
  p_trial_ends_at timestamptz,
  p_current_cycle_start timestamptz,
  p_current_cycle_end timestamptz,
  p_item_handles text[],
  p_pending_item_handles text[],
  p_observed_at timestamptz,
  p_source_hash text
)
returns table (
  workspace_id uuid,
  shop_id text,
  shop_domain text,
  install_generation bigint,
  entitlement_status text,
  reporting_store_limit smallint,
  candidate_detection_billed boolean,
  reporting_store_switch_billed boolean,
  source_observed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_installation shopify.installations%rowtype;
  previous_observed_at timestamptz;
begin
  if p_shop_id is null
     or p_shop_id !~ '^gid://shopify/Shop/[1-9][0-9]*$'
     or p_shop_domain is null
     or p_shop_domain !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
     or p_install_generation is null
     or p_install_generation < 1
     or p_observed_at is null
     or p_observed_at > statement_timestamp() + interval '1 minute'
     or p_source_hash is null
     or p_source_hash !~ '^[0-9a-f]{64}$'
     or p_item_handles is null
     or p_pending_item_handles is null
     or p_cancel_at_end_of_cycle is null
     or p_provider_active is null then
    raise exception 'INVALID_APP_PRICING_SNAPSHOT';
  end if;

  if cardinality(p_item_handles) <> (
    select count(distinct item_handle)
      from unnest(p_item_handles) as item_handle
     where item_handle ~ '^[a-z0-9][a-z0-9_-]{0,127}$'
  ) then
    raise exception 'INVALID_APP_PRICING_ITEM_HANDLES';
  end if;

  if cardinality(p_pending_item_handles) <> (
    select count(distinct item_handle)
      from unnest(p_pending_item_handles) as item_handle
     where item_handle ~ '^[a-z0-9][a-z0-9_-]{0,127}$'
  ) then
    raise exception 'INVALID_APP_PRICING_PENDING_ITEMS';
  end if;

  if (
    p_provider_active
    and p_entitlement_status = 'trial'
    and p_billing_period is not null
    and cardinality(p_item_handles) > 0
    and p_trial_ends_at > p_observed_at
    and p_current_cycle_start is null
    and p_current_cycle_end is null
  ) is not true
  and (
    p_provider_active
    and p_entitlement_status = 'active'
    and p_billing_period is not null
    and cardinality(p_item_handles) > 0
    and p_trial_ends_at is null
    and p_current_cycle_start is not null
    and p_current_cycle_end > p_current_cycle_start
  ) is not true
  and (
    not p_provider_active
    and p_entitlement_status = 'subscription_required'
    and p_billing_period is null
    and cardinality(p_item_handles) = 0
    and cardinality(p_pending_item_handles) = 0
    and p_trial_ends_at is null
    and p_current_cycle_start is null
    and p_current_cycle_end is null
    and not p_cancel_at_end_of_cycle
  ) is not true then
    raise exception 'INCONSISTENT_APP_PRICING_SNAPSHOT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'shopify-billing:' || p_shop_id || ':' || p_install_generation::text,
      0
    )
  );

  select installation.*
    into current_installation
    from shopify.installations as installation
   where installation.shop_id = p_shop_id
     and installation.shop_domain = p_shop_domain
     and installation.install_generation = p_install_generation
     and installation.status = 'active'
   for update;

  if not found then
    raise exception 'ACTIVE_INSTALLATION_REQUIRED';
  end if;

  select subscription.source_observed_at
    into previous_observed_at
    from billing.workspace_subscriptions as subscription
   where subscription.workspace_id = current_installation.workspace_id
     and subscription.install_generation = p_install_generation;

  if previous_observed_at is not null and p_observed_at < previous_observed_at then
    raise exception 'STALE_APP_PRICING_SNAPSHOT';
  end if;

  insert into billing.workspace_subscriptions (
    workspace_id,
    install_generation,
    installation_id,
    shop_id,
    shop_domain,
    provider_status,
    billing_period,
    cancel_at_end_of_cycle,
    trial_ends_at,
    current_cycle_start,
    current_cycle_end,
    item_handles,
    pending_item_handles,
    source_observed_at,
    source_hash,
    updated_at
  ) values (
    current_installation.workspace_id,
    p_install_generation,
    current_installation.id,
    p_shop_id,
    p_shop_domain,
    case when p_provider_active then 'active' else 'no_active_subscription' end,
    p_billing_period,
    p_cancel_at_end_of_cycle,
    p_trial_ends_at,
    p_current_cycle_start,
    p_current_cycle_end,
    p_item_handles,
    p_pending_item_handles,
    p_observed_at,
    p_source_hash,
    statement_timestamp()
  )
  on conflict on constraint workspace_subscriptions_pkey do update
    set provider_status = excluded.provider_status,
        billing_period = excluded.billing_period,
        cancel_at_end_of_cycle = excluded.cancel_at_end_of_cycle,
        trial_ends_at = excluded.trial_ends_at,
        current_cycle_start = excluded.current_cycle_start,
        current_cycle_end = excluded.current_cycle_end,
        item_handles = excluded.item_handles,
        pending_item_handles = excluded.pending_item_handles,
        source_observed_at = excluded.source_observed_at,
        source_hash = excluded.source_hash,
        updated_at = statement_timestamp();

  insert into billing.workspace_entitlements (
    workspace_id,
    install_generation,
    entitlement_status,
    reporting_store_limit,
    candidate_detection_billed,
    reporting_store_switch_billed,
    source_observed_at,
    source_hash,
    updated_at
  ) values (
    current_installation.workspace_id,
    p_install_generation,
    p_entitlement_status,
    1,
    false,
    false,
    p_observed_at,
    p_source_hash,
    statement_timestamp()
  )
  on conflict on constraint workspace_entitlements_pkey do update
    set entitlement_status = excluded.entitlement_status,
        reporting_store_limit = 1,
        candidate_detection_billed = false,
        reporting_store_switch_billed = false,
        source_observed_at = excluded.source_observed_at,
        source_hash = excluded.source_hash,
        updated_at = statement_timestamp();

  if p_entitlement_status = 'trial' then
    insert into billing.trial_ledger (
      workspace_id,
      install_generation,
      trial_ends_at,
      item_handles,
      source_observed_at,
      source_hash
    ) values (
      current_installation.workspace_id,
      p_install_generation,
      p_trial_ends_at,
      p_item_handles,
      p_observed_at,
      p_source_hash
    )
    on conflict on constraint trial_ledger_snapshot_unique do nothing;
  end if;

  return query
    select current_installation.workspace_id,
           p_shop_id,
           p_shop_domain,
           p_install_generation,
           p_entitlement_status,
           1::smallint,
           false,
           false,
           p_observed_at;
end
$function$;

create or replace function billing.resolve_workspace_entitlement(
  p_shop_id text,
  p_shop_domain text,
  p_install_generation bigint,
  p_fresh_after timestamptz
)
returns table (
  workspace_id uuid,
  install_generation bigint,
  entitlement_status text,
  reporting_store_limit smallint,
  source_observed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select installation.workspace_id,
         installation.install_generation,
         entitlement.entitlement_status,
         entitlement.reporting_store_limit,
         entitlement.source_observed_at
    from shopify.installations as installation
    join billing.workspace_entitlements as entitlement
      on entitlement.workspace_id = installation.workspace_id
     and entitlement.install_generation = installation.install_generation
   where installation.shop_id = p_shop_id
     and installation.shop_domain = p_shop_domain
     and installation.install_generation = p_install_generation
     and installation.status = 'active'
     and p_fresh_after is not null
     and entitlement.source_observed_at >= p_fresh_after
$function$;

revoke all on function billing.apply_shopify_app_pricing_snapshot(
  text, text, bigint, boolean, text, text, boolean, timestamptz,
  timestamptz, timestamptz, text[], text[], timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function billing.resolve_workspace_entitlement(
  text, text, bigint, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function billing.apply_shopify_app_pricing_snapshot(
  text, text, bigint, boolean, text, text, boolean, timestamptz,
  timestamptz, timestamptz, text[], text[], timestamptz, text
) to adstable_runtime;
grant execute on function billing.resolve_workspace_entitlement(
  text, text, bigint, timestamptz
) to adstable_runtime;

comment on table billing.workspace_subscriptions is
  'Shopify App Pricing projection. Shopify Partner API remains billing authority.';
comment on table billing.workspace_entitlements is
  'Fail-closed workspace entitlement projection; one active Reporting Store is included.';
comment on table billing.trial_ledger is
  'Immutable observations of Shopify-owned trial state; never a local trial grant.';
comment on function billing.apply_shopify_app_pricing_snapshot(
  text, text, bigint, boolean, text, text, boolean, timestamptz,
  timestamptz, timestamptz, text[], text[], timestamptz, text
) is
  'Persists a server-verified Partner API activeSubscription snapshot for the active installation generation.';

reset role;

commit;
