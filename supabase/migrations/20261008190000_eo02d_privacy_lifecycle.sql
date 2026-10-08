begin;

set local role adstable_owner;

alter table shopify.installations
  add column shop_identity_sha256 bytea,
  add constraint installations_identity_hash_size
    check (shop_identity_sha256 is null or octet_length(shop_identity_sha256) = 32);

create table privacy.webhook_claims (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  webhook_id text not null unique check (char_length(webhook_id) between 8 and 128),
  event_id text check (event_id is null or char_length(event_id) between 8 and 128),
  topic text not null check (topic in (
    'app/uninstalled', 'customers/data_request', 'customers/redact', 'shop/redact'
  )),
  workspace_id uuid references app.workspaces(id) on update restrict on delete restrict,
  install_generation bigint check (install_generation is null or install_generation > 0),
  shop_identity_sha256 bytea not null check (octet_length(shop_identity_sha256) = 32),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  api_version text check (api_version is null or api_version ~ '^[0-9]{4}-[0-9]{2}$'),
  triggered_at timestamptz,
  received_at timestamptz not null,
  outcome text not null check (outcome in ('claimed', 'queued', 'unbound', 'ignored_reinstalled')),
  created_at timestamptz not null default statement_timestamp(),
  constraint webhook_claim_timestamp_order check (
    triggered_at is null or received_at >= triggered_at - interval '1 minute'
  )
);

create index webhook_claims_workspace_idx
  on privacy.webhook_claims (workspace_id, install_generation, received_at desc);

create table privacy.deletion_runs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  claim_id uuid unique references privacy.webhook_claims(id) on update restrict on delete restrict,
  request_key text not null unique check (char_length(request_key) between 8 and 128),
  workspace_id uuid not null references app.workspaces(id) on update restrict on delete restrict,
  install_generation bigint not null check (install_generation > 0),
  shop_identity_sha256 bytea not null check (octet_length(shop_identity_sha256) = 32),
  kind text not null check (kind in (
    'customer_data_request', 'customer_redact', 'shop_redact', 'merchant_delete_my_data'
  )),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'superseded')),
  requested_at timestamptz not null,
  deadline_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint deletion_run_deadline_order check (deadline_at >= requested_at),
  constraint deletion_run_completion_shape check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index deletion_runs_pending_idx
  on privacy.deletion_runs (status, requested_at)
  where status in ('pending', 'failed');

create table privacy.deletion_manifests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  deletion_run_id uuid not null unique
    references privacy.deletion_runs(id) on update restrict on delete restrict,
  workspace_id uuid not null references app.workspaces(id) on update restrict on delete restrict,
  install_generation bigint not null check (install_generation > 0),
  shop_identity_sha256 bytea not null check (octet_length(shop_identity_sha256) = 32),
  kind text not null check (kind in (
    'customer_data_request', 'customer_redact', 'shop_redact', 'merchant_delete_my_data'
  )),
  manifest_version smallint not null default 1 check (manifest_version = 1),
  deleted_families text[] not null default '{}'::text[],
  retained_families text[] not null default '{}'::text[],
  row_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(row_counts) = 'object'),
  result text not null check (result in ('no_customer_data', 'deleted')),
  completed_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp()
);

create index deletion_manifests_identity_generation_idx
  on privacy.deletion_manifests (shop_identity_sha256, install_generation desc);

alter table privacy.webhook_claims enable row level security;
alter table privacy.webhook_claims force row level security;
alter table privacy.deletion_runs enable row level security;
alter table privacy.deletion_runs force row level security;
alter table privacy.deletion_manifests enable row level security;
alter table privacy.deletion_manifests force row level security;

create policy webhook_claims_owner_all on privacy.webhook_claims
  for all to adstable_owner using (true) with check (true);
create policy deletion_runs_owner_all on privacy.deletion_runs
  for all to adstable_owner using (true) with check (true);
create policy deletion_manifests_owner_all on privacy.deletion_manifests
  for all to adstable_owner using (true) with check (true);

revoke all on table privacy.webhook_claims
  from public, anon, authenticated, service_role, adstable_runtime;
revoke all on table privacy.deletion_runs
  from public, anon, authenticated, service_role, adstable_runtime;
revoke all on table privacy.deletion_manifests
  from public, anon, authenticated, service_role, adstable_runtime;

create or replace function shopify.bootstrap_installation(
  p_shop_id text,
  p_shop_domain text,
  p_shop_identity_sha256 bytea,
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
  current_installation shopify.installations%rowtype;
  created_workspace_id uuid;
  next_generation bigint;
begin
  if p_shop_id is null
     or p_shop_id !~ '^gid://shopify/Shop/[1-9][0-9]*$'
     or p_shop_domain is null
     or p_shop_domain !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
     or p_shop_identity_sha256 is null
     or octet_length(p_shop_identity_sha256) <> 32
     or p_verified_at is null
     or p_verified_at > statement_timestamp() + interval '1 minute' then
    raise exception 'INVALID_VERIFIED_SHOP_IDENTITY';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shopify-install:' || p_shop_id, 0)
  );

  select installation.*
    into current_installation
    from shopify.installations as installation
   where installation.shop_id = p_shop_id
     and installation.status in ('active', 'uninstall_pending_redaction', 'deletion_pending')
   order by installation.install_generation desc
   limit 1
   for update;

  if found then
    if current_installation.shop_identity_sha256 is not null
       and current_installation.shop_identity_sha256 <> p_shop_identity_sha256 then
      raise exception 'SHOP_IDENTITY_HASH_MISMATCH';
    end if;
    if current_installation.status = 'deletion_pending' then
      raise exception 'INSTALLATION_DELETION_PENDING';
    end if;
    if p_verified_at < current_installation.last_verified_at then
      raise exception 'STALE_SHOP_VERIFICATION';
    end if;

    if current_installation.shop_domain <> p_shop_domain then
      insert into shopify.installation_domain_history (
        installation_id, previous_shop_domain, replacement_shop_domain, changed_at
      ) values (
        current_installation.id, current_installation.shop_domain, p_shop_domain, p_verified_at
      );
    end if;

    update shopify.installations as installation
       set shop_domain = p_shop_domain,
           shop_identity_sha256 = p_shop_identity_sha256,
           status = 'active',
           last_verified_at = p_verified_at,
           updated_at = statement_timestamp()
     where installation.id = current_installation.id;

    update app.workspaces
       set status = 'active',
           version = version + 1,
           updated_at = statement_timestamp()
     where id = current_installation.workspace_id
       and status <> 'active';

    return query
      select current_installation.workspace_id,
             current_installation.install_generation,
             'active'::text,
             case when current_installation.status = 'uninstall_pending_redaction'
               then 'reactivated' else 'existing' end::text;
    return;
  end if;

  select coalesce(max(manifest.install_generation), 0) + 1
    into next_generation
    from privacy.deletion_manifests as manifest
   where manifest.shop_identity_sha256 = p_shop_identity_sha256;

  insert into app.workspaces (status) values ('active')
  returning id into created_workspace_id;

  insert into shopify.installations (
    shop_id, shop_domain, workspace_id, install_generation, status,
    installed_at, last_verified_at, updated_at, shop_identity_sha256
  ) values (
    p_shop_id, p_shop_domain, created_workspace_id, next_generation, 'active',
    p_verified_at, p_verified_at, statement_timestamp(), p_shop_identity_sha256
  );

  return query
    select created_workspace_id, next_generation, 'active'::text,
           case when next_generation = 1 then 'created' else 'new_generation' end::text;
end
$function$;

create or replace function privacy.claim_shopify_webhook(
  p_webhook_id text,
  p_event_id text,
  p_topic text,
  p_shop_id text,
  p_shop_domain text,
  p_shop_identity_sha256 bytea,
  p_payload_sha256 text,
  p_api_version text,
  p_triggered_at timestamptz,
  p_received_at timestamptz
)
returns table (
  claim_id uuid,
  deletion_run_id uuid,
  workspace_id uuid,
  install_generation bigint,
  outcome text,
  duplicate boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_claim privacy.webhook_claims%rowtype;
  current_installation shopify.installations%rowtype;
  created_claim_id uuid;
  created_run_id uuid;
  claim_outcome text := 'claimed';
  run_kind text;
begin
  if p_webhook_id is null
     or char_length(p_webhook_id) not between 8 and 128
     or p_topic not in (
       'app/uninstalled', 'customers/data_request', 'customers/redact', 'shop/redact'
     )
     or p_shop_id is null
     or p_shop_id !~ '^gid://shopify/Shop/[1-9][0-9]*$'
     or p_shop_domain is null
     or p_shop_domain !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
     or p_shop_identity_sha256 is null
     or octet_length(p_shop_identity_sha256) <> 32
     or p_payload_sha256 is null
     or p_payload_sha256 !~ '^[0-9a-f]{64}$'
     or p_received_at is null
     or p_received_at > statement_timestamp() + interval '1 minute'
     or (p_api_version is not null and p_api_version !~ '^[0-9]{4}-[0-9]{2}$') then
    raise exception 'INVALID_VERIFIED_WEBHOOK_CLAIM';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shopify-webhook:' || p_webhook_id, 0)
  );

  select claim.* into existing_claim
    from privacy.webhook_claims as claim
   where claim.webhook_id = p_webhook_id;

  if found then
    return query
      select existing_claim.id, run.id, existing_claim.workspace_id,
             existing_claim.install_generation, existing_claim.outcome, true
        from (select 1) as singleton
        left join privacy.deletion_runs as run on run.claim_id = existing_claim.id;
    return;
  end if;

  select installation.* into current_installation
    from shopify.installations as installation
   where installation.shop_id = p_shop_id
     and installation.shop_domain = p_shop_domain
     and installation.status in ('active', 'uninstall_pending_redaction', 'deletion_pending')
   order by installation.install_generation desc
   limit 1
   for update;

  if found
     and current_installation.shop_identity_sha256 is not null
     and current_installation.shop_identity_sha256 <> p_shop_identity_sha256 then
    raise exception 'SHOP_IDENTITY_HASH_MISMATCH';
  end if;

  if not found then
    claim_outcome := 'unbound';
  elsif p_topic = 'app/uninstalled' then
    if current_installation.status = 'active' then
      update shopify.installations
         set status = 'uninstall_pending_redaction',
             shop_identity_sha256 = p_shop_identity_sha256,
             updated_at = statement_timestamp()
       where id = current_installation.id;
      update app.workspaces
         set status = 'suspended', version = version + 1,
             updated_at = statement_timestamp()
       where id = current_installation.workspace_id and status = 'active';
      delete from shopify.runtime_sessions where shop_domain = p_shop_domain;
    end if;
  elsif p_topic = 'shop/redact' then
    if current_installation.status = 'uninstall_pending_redaction' then
      claim_outcome := 'queued';
      run_kind := 'shop_redact';
      update shopify.installations
         set status = 'deletion_pending',
             shop_identity_sha256 = p_shop_identity_sha256,
             updated_at = statement_timestamp()
       where id = current_installation.id;
    elsif current_installation.status = 'active' then
      claim_outcome := 'ignored_reinstalled';
    else
      claim_outcome := 'queued';
      run_kind := 'shop_redact';
    end if;
  elsif current_installation.status = 'active' then
    claim_outcome := 'queued';
    run_kind := case p_topic
      when 'customers/data_request' then 'customer_data_request'
      else 'customer_redact'
    end;
  else
    claim_outcome := 'unbound';
  end if;

  insert into privacy.webhook_claims (
    webhook_id, event_id, topic, workspace_id, install_generation,
    shop_identity_sha256, payload_sha256, api_version, triggered_at, received_at, outcome
  ) values (
    p_webhook_id, p_event_id, p_topic, current_installation.workspace_id,
    current_installation.install_generation, p_shop_identity_sha256,
    p_payload_sha256, p_api_version, p_triggered_at, p_received_at, claim_outcome
  ) returning id into created_claim_id;

  if run_kind is not null then
    insert into privacy.deletion_runs (
      claim_id, request_key, workspace_id, install_generation,
      shop_identity_sha256, kind, requested_at, deadline_at
    ) values (
      created_claim_id, 'shopify-webhook:' || p_webhook_id,
      current_installation.workspace_id, current_installation.install_generation,
      p_shop_identity_sha256, run_kind, p_received_at, p_received_at + interval '30 days'
    ) returning id into created_run_id;
  end if;

  return query
    select created_claim_id, created_run_id, current_installation.workspace_id,
           current_installation.install_generation, claim_outcome, false;
end
$function$;

create or replace function privacy.request_workspace_deletion(
  p_request_key text,
  p_shop_id text,
  p_shop_domain text,
  p_install_generation bigint,
  p_shop_identity_sha256 bytea,
  p_requested_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_installation shopify.installations%rowtype;
  existing_run_id uuid;
  created_run_id uuid;
begin
  if p_request_key is null or char_length(p_request_key) not between 8 and 128
     or p_shop_id is null or p_shop_id !~ '^gid://shopify/Shop/[1-9][0-9]*$'
     or p_shop_domain is null
     or p_shop_domain !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
     or p_install_generation is null or p_install_generation < 1
     or p_shop_identity_sha256 is null or octet_length(p_shop_identity_sha256) <> 32
     or p_requested_at is null
     or p_requested_at > statement_timestamp() + interval '1 minute' then
    raise exception 'INVALID_WORKSPACE_DELETION_REQUEST';
  end if;

  select run.id into existing_run_id
    from privacy.deletion_runs as run where run.request_key = p_request_key;
  if found then return existing_run_id; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'shopify-delete:' || p_shop_id || ':' || p_install_generation::text, 0
    )
  );

  select installation.* into current_installation
    from shopify.installations as installation
   where installation.shop_id = p_shop_id
     and installation.shop_domain = p_shop_domain
     and installation.install_generation = p_install_generation
     and installation.status = 'active'
   for update;

  if not found then raise exception 'ACTIVE_INSTALLATION_REQUIRED'; end if;
  if current_installation.shop_identity_sha256 is not null
     and current_installation.shop_identity_sha256 <> p_shop_identity_sha256 then
    raise exception 'SHOP_IDENTITY_HASH_MISMATCH';
  end if;

  update shopify.installations
     set status = 'deletion_pending',
         shop_identity_sha256 = p_shop_identity_sha256,
         updated_at = statement_timestamp()
   where id = current_installation.id;
  update app.workspaces
     set status = 'suspended', version = version + 1,
         updated_at = statement_timestamp()
   where id = current_installation.workspace_id;
  delete from shopify.runtime_sessions where shop_domain = p_shop_domain;

  insert into privacy.deletion_runs (
    request_key, workspace_id, install_generation, shop_identity_sha256,
    kind, requested_at, deadline_at
  ) values (
    p_request_key, current_installation.workspace_id,
    current_installation.install_generation, p_shop_identity_sha256,
    'merchant_delete_my_data', p_requested_at, p_requested_at + interval '30 days'
  ) returning id into created_run_id;

  return created_run_id;
end
$function$;

create or replace function privacy.execute_deletion_run(p_run_id uuid)
returns table (
  deletion_run_id uuid,
  deletion_status text,
  manifest_id uuid,
  manifest_result text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_run privacy.deletion_runs%rowtype;
  current_installation shopify.installations%rowtype;
  existing_manifest privacy.deletion_manifests%rowtype;
  created_manifest_id uuid;
  deleted_trial bigint := 0;
  deleted_entitlement bigint := 0;
  deleted_subscription bigint := 0;
  deleted_session bigint := 0;
  deleted_domain_history bigint := 0;
  deleted_installation bigint := 0;
begin
  select run.* into current_run
    from privacy.deletion_runs as run where run.id = p_run_id for update;
  if not found then raise exception 'DELETION_RUN_NOT_FOUND'; end if;

  select manifest.* into existing_manifest
    from privacy.deletion_manifests as manifest
   where manifest.deletion_run_id = p_run_id;
  if found then
    return query
      select current_run.id, 'completed'::text,
             existing_manifest.id, existing_manifest.result;
    return;
  end if;

  if current_run.status not in ('pending', 'failed') then
    raise exception 'DELETION_RUN_NOT_EXECUTABLE';
  end if;

  update privacy.deletion_runs
     set status = 'running',
         started_at = coalesce(started_at, statement_timestamp()),
         attempt_count = attempt_count + 1,
         last_error_code = null,
         updated_at = statement_timestamp()
   where id = current_run.id;

  if current_run.kind in ('customer_data_request', 'customer_redact') then
    insert into privacy.deletion_manifests (
      deletion_run_id, workspace_id, install_generation, shop_identity_sha256,
      kind, deleted_families, retained_families, row_counts, result, completed_at
    ) values (
      current_run.id, current_run.workspace_id, current_run.install_generation,
      current_run.shop_identity_sha256, current_run.kind, '{}'::text[],
      array['aggregated_non_customer_scoped_foundation'],
      '{"customer_scoped_rows":0}'::jsonb, 'no_customer_data', statement_timestamp()
    ) returning id into created_manifest_id;

    update privacy.deletion_runs
       set status = 'completed', completed_at = statement_timestamp(),
           updated_at = statement_timestamp()
     where id = current_run.id;

    return query
      select current_run.id, 'completed'::text,
             created_manifest_id, 'no_customer_data'::text;
    return;
  end if;

  select installation.* into current_installation
    from shopify.installations as installation
   where installation.workspace_id = current_run.workspace_id
     and installation.install_generation = current_run.install_generation
     and installation.status = 'deletion_pending'
     and installation.shop_identity_sha256 = current_run.shop_identity_sha256
   for update;

  if not found then
    update privacy.deletion_runs
       set status = 'superseded',
           last_error_code = 'GENERATION_NO_LONGER_DELETION_PENDING',
           updated_at = statement_timestamp()
     where id = current_run.id;
    return query
      select current_run.id, 'superseded'::text, null::uuid, null::text;
    return;
  end if;

  delete from billing.trial_ledger
   where workspace_id = current_run.workspace_id
     and install_generation = current_run.install_generation;
  get diagnostics deleted_trial = row_count;
  delete from billing.workspace_entitlements
   where workspace_id = current_run.workspace_id
     and install_generation = current_run.install_generation;
  get diagnostics deleted_entitlement = row_count;
  delete from billing.workspace_subscriptions
   where workspace_id = current_run.workspace_id
     and install_generation = current_run.install_generation;
  get diagnostics deleted_subscription = row_count;
  delete from shopify.runtime_sessions
   where shop_domain = current_installation.shop_domain;
  get diagnostics deleted_session = row_count;
  delete from shopify.installation_domain_history
   where installation_id = current_installation.id;
  get diagnostics deleted_domain_history = row_count;
  delete from shopify.installations where id = current_installation.id;
  get diagnostics deleted_installation = row_count;

  update app.workspaces
     set status = 'archived', version = version + 1,
         updated_at = statement_timestamp()
   where id = current_run.workspace_id;

  insert into privacy.deletion_manifests (
    deletion_run_id, workspace_id, install_generation, shop_identity_sha256,
    kind, deleted_families, retained_families, row_counts, result, completed_at
  ) values (
    current_run.id, current_run.workspace_id, current_run.install_generation,
    current_run.shop_identity_sha256, current_run.kind,
    array[
      'billing_projection', 'shopify_runtime_sessions',
      'shopify_installation', 'shopify_domain_history'
    ],
    array['pseudonymous_generation_tombstone', 'non_personal_deletion_evidence'],
    pg_catalog.jsonb_build_object(
      'billing_trial_ledger', deleted_trial,
      'billing_workspace_entitlements', deleted_entitlement,
      'billing_workspace_subscriptions', deleted_subscription,
      'shopify_runtime_sessions', deleted_session,
      'shopify_installation_domain_history', deleted_domain_history,
      'shopify_installations', deleted_installation
    ),
    'deleted', statement_timestamp()
  ) returning id into created_manifest_id;

  update privacy.deletion_runs
     set status = 'completed', completed_at = statement_timestamp(),
         updated_at = statement_timestamp()
   where id = current_run.id;

  return query
    select current_run.id, 'completed'::text,
           created_manifest_id, 'deleted'::text;
end
$function$;

revoke all on function shopify.bootstrap_installation(text, text, bytea, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function privacy.claim_shopify_webhook(
  text, text, text, text, text, bytea, text, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function privacy.request_workspace_deletion(
  text, text, text, bigint, bytea, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function privacy.execute_deletion_run(uuid)
  from public, anon, authenticated, service_role;

grant execute on function shopify.bootstrap_installation(text, text, bytea, timestamptz)
  to adstable_runtime;
grant execute on function privacy.claim_shopify_webhook(
  text, text, text, text, text, bytea, text, text, timestamptz, timestamptz
) to adstable_runtime;
grant execute on function privacy.request_workspace_deletion(
  text, text, text, bigint, bytea, timestamptz
) to adstable_runtime;
grant execute on function privacy.execute_deletion_run(uuid)
  to adstable_runtime;

comment on table privacy.webhook_claims is
  'HMAC-verified Shopify delivery claims. Raw payload, customer email, phone and shop domain are not retained.';
comment on table privacy.deletion_runs is
  'Idempotent privacy lifecycle work queue scoped to one workspace and installation generation.';
comment on table privacy.deletion_manifests is
  'Non-personal deletion evidence and pseudonymous generation continuity tombstone.';
comment on function privacy.execute_deletion_run(uuid) is
  'Generation-locked deletion executor. It cannot target a replacement workspace or installation generation.';

reset role;

commit;
