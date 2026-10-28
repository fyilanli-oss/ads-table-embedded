begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;
create function shopify.load_active_installation_owner(p_workspace uuid,p_generation bigint,p_shop text,p_domain text)
returns table(installation_id text,workspace_id uuid,install_generation bigint,shop_id text,shop_domain text,installation_status text)
language sql stable security definer set search_path='' as $function$
 select i.id::text,i.workspace_id,i.install_generation,i.shop_id,i.shop_domain,i.status
 from shopify.installations i where i.workspace_id=p_workspace and i.install_generation=p_generation
 and i.shop_id=p_shop and i.shop_domain=p_domain and i.status='active'
$function$;
revoke all on function shopify.load_active_installation_owner(uuid,bigint,text,text)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function shopify.load_active_installation_owner(uuid,bigint,text,text) to adstable_runtime;
commit;
