begin;

set local role adstable_owner;

do $probe$
declare
  probe_workspace uuid := '018f4e01-5a2d-7b19-8d43-1f7b0d5e0c21';
  probe_installation_id bigint;
  probe_shop_id text := 'gid://shopify/Shop/920261006170001';
  probe_domain text := 'eo02c-probe.myshopify.com';
  trial_observed timestamptz := statement_timestamp() - interval '2 hours';
begin
  insert into app.workspaces (id, status)
  values (probe_workspace, 'active');

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
    probe_shop_id,
    probe_domain,
    probe_workspace,
    1,
    'active',
    trial_observed - interval '1 hour',
    trial_observed,
    trial_observed
  )
  returning id into probe_installation_id;

  perform *
    from billing.apply_shopify_app_pricing_snapshot(
      probe_shop_id,
      probe_domain,
      1,
      true,
      'trial',
      'EVERY_30_DAYS',
      false,
      trial_observed + interval '14 days',
      null,
      null,
      array['ads_table_monthly'],
      '{}'::text[],
      trial_observed,
      repeat('a', 64)
    );

  perform *
    from billing.apply_shopify_app_pricing_snapshot(
      probe_shop_id,
      probe_domain,
      1,
      true,
      'trial',
      'EVERY_30_DAYS',
      false,
      trial_observed + interval '14 days',
      null,
      null,
      array['ads_table_monthly'],
      '{}'::text[],
      trial_observed,
      repeat('a', 64)
    );

  if (select count(*) from billing.trial_ledger where workspace_id = probe_workspace) <> 1 then
    raise exception 'EO02C_TRIAL_IDEMPOTENCY_FAILED';
  end if;

  begin
    perform *
      from billing.apply_shopify_app_pricing_snapshot(
        probe_shop_id,
        probe_domain,
        1,
        true,
        'active',
        'EVERY_30_DAYS',
        false,
        null,
        trial_observed - interval '1 day',
        trial_observed + interval '29 days',
        array['ads_table_monthly'],
        '{}'::text[],
        trial_observed - interval '1 second',
        repeat('b', 64)
      );
    raise exception 'EO02C_STALE_SNAPSHOT_WAS_ACCEPTED';
  exception
    when raise_exception then
      if sqlerrm <> 'STALE_APP_PRICING_SNAPSHOT' then
        raise;
      end if;
  end;

  perform *
    from billing.apply_shopify_app_pricing_snapshot(
      probe_shop_id,
      probe_domain,
      1,
      true,
      'active',
      'EVERY_30_DAYS',
      false,
      null,
      trial_observed - interval '1 day',
      trial_observed + interval '29 days',
      array['ads_table_monthly'],
      '{}'::text[],
      trial_observed + interval '1 hour',
      repeat('c', 64)
    );

  if not exists (
    select 1
      from billing.resolve_workspace_entitlement(
        probe_shop_id,
        probe_domain,
        1,
        trial_observed + interval '30 minutes'
      )
     where entitlement_status = 'active'
       and reporting_store_limit = 1
  ) then
    raise exception 'EO02C_ACTIVE_ENTITLEMENT_RESOLUTION_FAILED';
  end if;

  if exists (
    select 1
      from billing.resolve_workspace_entitlement(
        probe_shop_id,
        probe_domain,
        1,
        trial_observed + interval '90 minutes'
      )
  ) then
    raise exception 'EO02C_STALE_ENTITLEMENT_DID_NOT_FAIL_CLOSED';
  end if;

  perform *
    from billing.apply_shopify_app_pricing_snapshot(
      probe_shop_id,
      probe_domain,
      1,
      false,
      'subscription_required',
      null,
      false,
      null,
      null,
      null,
      '{}'::text[],
      '{}'::text[],
      trial_observed + interval '90 minutes',
      repeat('d', 64)
    );

  if not exists (
    select 1
      from billing.workspace_entitlements
     where workspace_id = probe_workspace
       and install_generation = 1
       and entitlement_status = 'subscription_required'
       and reporting_store_limit = 1
       and not candidate_detection_billed
       and not reporting_store_switch_billed
  ) then
    raise exception 'EO02C_SUBSCRIPTION_REQUIRED_PROJECTION_FAILED';
  end if;

  delete from billing.trial_ledger where workspace_id = probe_workspace;
  delete from billing.workspace_entitlements where workspace_id = probe_workspace;
  delete from billing.workspace_subscriptions where workspace_id = probe_workspace;
  delete from shopify.installations where id = probe_installation_id;
  delete from app.workspaces where id = probe_workspace;

  if exists (select 1 from app.workspaces where id = probe_workspace)
     or exists (select 1 from shopify.installations where id = probe_installation_id)
     or exists (select 1 from billing.workspace_subscriptions where workspace_id = probe_workspace)
     or exists (select 1 from billing.workspace_entitlements where workspace_id = probe_workspace)
     or exists (select 1 from billing.trial_ledger where workspace_id = probe_workspace) then
    raise exception 'EO02C_ACCEPTANCE_PROBE_CLEANUP_FAILED';
  end if;
end
$probe$;

reset role;

commit;
