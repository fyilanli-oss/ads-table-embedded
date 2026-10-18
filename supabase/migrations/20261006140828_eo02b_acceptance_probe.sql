begin;

set local role adstable_owner;

do $probe$
declare
  probe_shop_id constant text := 'gid://shopify/Shop/9999999999999999999999999999999999999999';
  verified_at timestamptz := statement_timestamp();
  first_result record;
  second_result record;
  changed_result record;
  resolved_result record;
begin
  select * into strict first_result
    from shopify.bootstrap_installation(
      probe_shop_id,
      'eo02b-probe.myshopify.com',
      verified_at
    );

  select * into strict second_result
    from shopify.bootstrap_installation(
      probe_shop_id,
      'eo02b-probe.myshopify.com',
      verified_at
    );

  if first_result.disposition <> 'created'
     or second_result.disposition <> 'existing'
     or first_result.workspace_id <> second_result.workspace_id
     or first_result.install_generation <> 1
     or second_result.install_generation <> 1 then
    raise exception 'EO02B_IDEMPOTENCY_ASSERTION_FAILED';
  end if;

  begin
    perform *
      from shopify.bootstrap_installation(
        probe_shop_id,
        'eo02b-probe.myshopify.com',
        verified_at - interval '1 second'
      );
    raise exception 'EO02B_STALE_VERIFICATION_WAS_ACCEPTED';
  exception
    when others then
      if sqlerrm <> 'STALE_SHOP_VERIFICATION' then
        raise;
      end if;
  end;

  select * into strict changed_result
    from shopify.bootstrap_installation(
      probe_shop_id,
      'eo02b-probe-renamed.myshopify.com',
      verified_at
    );

  select * into strict resolved_result
    from shopify.resolve_active_installation(
      probe_shop_id,
      'eo02b-probe-renamed.myshopify.com'
    );

  if changed_result.workspace_id <> first_result.workspace_id
     or changed_result.install_generation <> 1
     or resolved_result.workspace_id <> first_result.workspace_id
     or resolved_result.install_generation <> 1
     or resolved_result.installation_status <> 'active'
     or (
       select count(*)
         from shopify.installation_domain_history as history
         join shopify.installations as installation
           on installation.id = history.installation_id
        where installation.shop_id = probe_shop_id
     ) <> 1 then
    raise exception 'EO02B_DOMAIN_RECONCILIATION_ASSERTION_FAILED';
  end if;

  delete from shopify.installation_domain_history as history
   using shopify.installations as installation
   where history.installation_id = installation.id
     and installation.shop_id = probe_shop_id;

  delete from shopify.installations
   where shop_id = probe_shop_id;

  delete from app.workspaces
   where id = first_result.workspace_id;

  if exists (
    select 1 from shopify.installations where shop_id = probe_shop_id
  ) or exists (
    select 1 from app.workspaces where id = first_result.workspace_id
  ) then
    raise exception 'EO02B_ACCEPTANCE_PROBE_CLEANUP_FAILED';
  end if;
end
$probe$;

reset role;

commit;
