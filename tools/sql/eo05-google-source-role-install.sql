-- Prepared only. Separate explicit approval is required before live execution.
-- NOLOGIN, no password/key, no membership in existing roles, no activation.
-- Execute once as postgres with stop-on-error, never continue after an error.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$
declare ready boolean;
begin
 if exists(select 1 from pg_roles where rolname='adstable_google_source_runner') then
  raise exception 'GOOGLE_SOURCE_ROLE_ALREADY_EXISTS';
 end if;
 with expected(signature,definition_sha256) as (values
 ('integrations.load_provider_identity_authority(uuid,bigint,text,text,text)','363600cc8bb2212cc89e5c505700553639e353944a4349bf1413001fad105cad'),
 ('operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)','b52508bac61f17b7ba075f68b706b9204adf2e0694f435a269990ad41d867684'),
 ('operations.resolve_shared_api_quota_route(text,text,text)','9f6677b764889772617a5d83ecba206019828269c41617412952171a2cfe1d82'),
 ('operations.reserve_shared_api_quota(text,uuid,text)','a52181cc42196b6c0cde53264b5c7f29fd95542279251208a53bbd81442518cb'),
 ('operations.stop_shared_api_quota_scoped(text,uuid,boolean,boolean,text)','50b28305d030269367cfb3c9a804613634e610fb732debb86aae307b003bcdab'),
 ('operations.stop_shared_api_quota_google_observed(text,uuid,text,text)','dce553ea773a10aaf682e2816bf9e42445ca0bdfc3e49c1a09cfc8e7b817291c'),
 ('operations.settle_shared_api_quota(text,uuid)','5ddf973625e3b6d823fbfe0e360889d0d545c8430dec1f43ab2a067f5e1318db'),
 ('operations.record_shared_api_quota_feedback(text,uuid,jsonb)','bee5ea01cda8968c1f3056576230c098e6eae8094d96bd30763ae46805068ede'),
 ('operations.record_shopify_admin_quota_feedback(text,uuid,jsonb)','747217ec800673bd970002b91a527e92f8baf0a535bd42d1398c099f60971c06'),
 ('evidence.commit_google_identity_source(jsonb,uuid,integer,jsonb,jsonb)','213a54227bfd2fe48ddb3c1a2d238a727e9b51f96da37db63998a3c9ca1535d7'),
 ('evidence.read_source_receipt(jsonb,uuid,integer)','b07c0786eef25c0cb8acf01c59930d94eec7d7ae8368c223f4085bbf3c683b75'),
 ('identity.source_rule_review_state(jsonb,bigint,jsonb)','a2427a5aaead678d819e33496f31db3d8e9fd966d75a933acfff0e3ec66341a8'),
 ('identity.commit_reviewed_source_rule(jsonb,uuid,jsonb)','e43d88621bacaf17d0c613b49f0e18fbe4c372c7697dd89507f94ac0dd59e9fd'),
 ('identity.mapping_review_state(jsonb,bigint,bigint,boolean)','6e17863eea7d09a829e8f8fd2a167ed18d28a936db73366c643ff2f9cf7c2c95'),
 ('identity.commit_verified_mapping(jsonb,uuid,jsonb)','0e57ccac788bc033e82ffa7059990cca65d183b582728efc46b540703d27460f'),
 ('identity.lookup_verified_mapping(jsonb,jsonb)','f6c28582fa4730b3e2c0a453ff502b0e9712e703a849b2a6d24dc7bd8673bb15'))
 select current_user='postgres'
 and current_setting('server_version_num')::integer between 170000 and 179999
 and exists(select 1 from pg_roles where rolname='adstable_owner' and not rolcanlogin and not rolsuper and not rolbypassrls)
 and (select count(*) from pg_namespace n join pg_roles r on r.oid=n.nspowner
      where n.nspname in ('integrations','operations','evidence','identity') and r.rolname='adstable_owner')=4
 and not exists(select 1 from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
      left join pg_roles r on r.oid=p.proowner
      where p.oid is null or r.rolname<>'adstable_owner' or not p.prosecdef
       or not coalesce(p.proconfig @> array['search_path=""'],false)
       or encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')<>e.definition_sha256
       or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where a.privilege_type='EXECUTE' and (a.grantee=0 or a.grantee in
           (select oid from pg_roles where rolname in ('anon','authenticated','service_role')))))
 and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='evidence' and c.relname='source_batches' and c.relkind='r')
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source') and c.relkind in ('r','p') and (not c.relrowsecurity or not c.relforcerowsecurity))
 into ready;
 if ready is distinct from true then raise exception 'GOOGLE_SOURCE_ROLE_PREREQUISITES_CHANGED'; end if;
end
$preflight$;
create role adstable_google_source_runner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password null;
set local role adstable_owner;
grant usage on schema integrations,operations,evidence,identity to adstable_google_source_runner;
grant execute on function integrations.load_provider_identity_authority(uuid,bigint,text,text,text) to adstable_google_source_runner;
grant execute on function operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz) to adstable_google_source_runner;
grant execute on function operations.resolve_shared_api_quota_route(text,text,text) to adstable_google_source_runner;
grant execute on function operations.reserve_shared_api_quota(text,uuid,text) to adstable_google_source_runner;
grant execute on function operations.stop_shared_api_quota_scoped(text,uuid,boolean,boolean,text) to adstable_google_source_runner;
grant execute on function operations.stop_shared_api_quota_google_observed(text,uuid,text,text) to adstable_google_source_runner;
grant execute on function operations.settle_shared_api_quota(text,uuid) to adstable_google_source_runner;
grant execute on function operations.record_shared_api_quota_feedback(text,uuid,jsonb) to adstable_google_source_runner;
grant execute on function operations.record_shopify_admin_quota_feedback(text,uuid,jsonb) to adstable_google_source_runner;
grant execute on function evidence.commit_google_identity_source(jsonb,uuid,integer,jsonb,jsonb) to adstable_google_source_runner;
grant execute on function evidence.read_source_receipt(jsonb,uuid,integer) to adstable_google_source_runner;
grant execute on function identity.source_rule_review_state(jsonb,bigint,jsonb) to adstable_google_source_runner;
grant execute on function identity.commit_reviewed_source_rule(jsonb,uuid,jsonb) to adstable_google_source_runner;
grant execute on function identity.mapping_review_state(jsonb,bigint,bigint,boolean) to adstable_google_source_runner;
grant execute on function identity.commit_verified_mapping(jsonb,uuid,jsonb) to adstable_google_source_runner;
grant execute on function identity.lookup_verified_mapping(jsonb,jsonb) to adstable_google_source_runner;
reset role;
do $postflight$
declare valid boolean; inactive boolean;
begin
 select q.profile_ready into valid from (select 'adstable_google_source_runner' as role,
 (not r.rolsuper and not r.rolinherit and not r.rolbypassrls and not r.rolcreatedb and not r.rolcreaterole and not r.rolreplication
 and not exists(select 1 from pg_auth_members m where m.member=r.oid)
 and not has_database_privilege('adstable_google_source_runner',current_database(),'CREATE')
 and not exists(select 1 from unnest(array['integrations','operations','evidence','identity']) s(name)
  where not has_schema_privilege('adstable_google_source_runner',s.name,'USAGE'))
 and not exists(select 1 from pg_namespace n where n.nspname in ('public','app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
  and has_schema_privilege('adstable_google_source_runner',n.oid,'CREATE'))
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
   and c.relkind in ('r','p') and has_table_privilege('adstable_google_source_runner',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 and not exists(select 1 from unnest(array['integrations.load_provider_identity_authority(uuid,bigint,text,text,text)','operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)','operations.resolve_shared_api_quota_route(text,text,text)','operations.reserve_shared_api_quota(text,uuid,text)','operations.stop_shared_api_quota_scoped(text,uuid,boolean,boolean,text)','operations.stop_shared_api_quota_google_observed(text,uuid,text,text)','operations.settle_shared_api_quota(text,uuid)','operations.record_shared_api_quota_feedback(text,uuid,jsonb)','operations.record_shopify_admin_quota_feedback(text,uuid,jsonb)','evidence.commit_google_identity_source(jsonb,uuid,integer,jsonb,jsonb)','evidence.read_source_receipt(jsonb,uuid,integer)','identity.source_rule_review_state(jsonb,bigint,jsonb)','identity.commit_reviewed_source_rule(jsonb,uuid,jsonb)','identity.mapping_review_state(jsonb,bigint,bigint,boolean)','identity.commit_verified_mapping(jsonb,uuid,jsonb)','identity.lookup_verified_mapping(jsonb,jsonb)']::text[]) s(signature) where to_regprocedure(s.signature) is null
   or not coalesce(has_function_privilege('adstable_google_source_runner',to_regprocedure(s.signature)::oid,'EXECUTE'),false))
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
   and has_function_privilege('adstable_google_source_runner',p.oid,'EXECUTE') and not ((n.nspname='evidence' and p.proname='begin_dataset_storage_operation' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text||' '||pg_catalog.to_regtype('uuid')::oid::text||' '||pg_catalog.to_regtype('uuid')::oid::text||' '||pg_catalog.to_regtype('text')::oid::text||' '||pg_catalog.to_regtype('timestamptz')::oid::text)) or (n.nspname='evidence' and p.proname='assert_source_owner' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text)) or (n.nspname='evidence' and p.proname='read_source_receipt' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text||' '||pg_catalog.to_regtype('uuid')::oid::text||' '||pg_catalog.to_regtype('integer')::oid::text)) or (n.nspname='evidence' and p.proname='read_source_pages' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text||' '||pg_catalog.to_regtype('uuid')::oid::text||' '||pg_catalog.to_regtype('integer')::oid::text||' '||pg_catalog.to_regtype('bigint')::oid::text||' '||pg_catalog.to_regtype('integer')::oid::text)) or (n.nspname='evidence' and p.proname='read_dataset_source_context' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text||' '||pg_catalog.to_regtype('text')::oid::text||' '||pg_catalog.to_regtype('bigint')::oid::text||' '||pg_catalog.to_regtype('date')::oid::text||' '||pg_catalog.to_regtype('date')::oid::text)) or (n.nspname='analytics' and p.proname='commit_dataset_storage' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text||' '||pg_catalog.to_regtype('jsonb')::oid::text)) or (n.nspname='analytics' and p.proname='inspect_dataset_storage' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text||' '||pg_catalog.to_regtype('bigint')::oid::text||' '||pg_catalog.to_regtype('uuid')::oid::text)) or (n.nspname='analytics' and p.proname='commit_dataset_empty_retention' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text||' '||pg_catalog.to_regtype('jsonb')::oid::text)) or (n.nspname='analytics' and p.proname='inspect_dataset_empty_retention' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text||' '||pg_catalog.to_regtype('bigint')::oid::text||' '||pg_catalog.to_regtype('uuid')::oid::text)) or (n.nspname='app' and p.proname='read_reporting_currency' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text)) or (n.nspname='analytics' and p.proname='lookup_dataset_fx' and p.proargtypes::text=(pg_catalog.to_regtype('text')::oid::text||' '||pg_catalog.to_regtype('text')::oid::text||' '||pg_catalog.to_regtype('date')::oid::text)) or (n.nspname='analytics' and p.proname='record_dataset_fx' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text)) or (n.nspname='analytics' and p.proname='commit_dataset_reconciliation' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text||' '||pg_catalog.to_regtype('jsonb')::oid::text||' '||pg_catalog.to_regtype('jsonb')::oid::text||' '||pg_catalog.to_regtype('timestamptz')::oid::text)) or (n.nspname='analytics' and p.proname='inspect_dataset_reconciliation' and p.proargtypes::text=(pg_catalog.to_regtype('jsonb')::oid::text||' '||pg_catalog.to_regtype('uuid')::oid::text)))
   and p.oid<>coalesce(to_regprocedure('evidence.find_google_pmax_source_batches(jsonb,date,integer)')::oid,0)
   and p.oid not in
    (select to_regprocedure(s.signature)::oid from unnest(array['integrations.load_provider_identity_authority(uuid,bigint,text,text,text)','operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)','operations.resolve_shared_api_quota_route(text,text,text)','operations.reserve_shared_api_quota(text,uuid,text)','operations.stop_shared_api_quota_scoped(text,uuid,boolean,boolean,text)','operations.stop_shared_api_quota_google_observed(text,uuid,text,text)','operations.settle_shared_api_quota(text,uuid)','operations.record_shared_api_quota_feedback(text,uuid,jsonb)','operations.record_shopify_admin_quota_feedback(text,uuid,jsonb)','evidence.commit_google_identity_source(jsonb,uuid,integer,jsonb,jsonb)','evidence.read_source_receipt(jsonb,uuid,integer)','identity.source_rule_review_state(jsonb,bigint,jsonb)','identity.commit_reviewed_source_rule(jsonb,uuid,jsonb)','identity.mapping_review_state(jsonb,bigint,bigint,boolean)','identity.commit_verified_mapping(jsonb,uuid,jsonb)','identity.lookup_verified_mapping(jsonb,jsonb)']::text[]) s(signature)))
 ) as profile_ready from pg_roles r where r.rolname='adstable_google_source_runner') q;
 select q.inactive into inactive from (select not r.rolcanlogin and not r.rolsuper and not r.rolinherit and not r.rolbypassrls
 and not r.rolcreatedb and not r.rolcreaterole and not r.rolreplication
 and not exists(select 1 from pg_auth_members m where m.member=r.oid)
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where case when n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source') and c.relkind in ('r','p')
   then has_table_privilege(r.oid,c.oid,'MAINTAIN') or has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') else false end)
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where case when n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source') and c.relkind='S'
   then has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE') else false end)
 as inactive from pg_roles r where r.rolname='adstable_google_source_runner') q;
 if valid is distinct from true or inactive is distinct from true then
  raise exception 'GOOGLE_SOURCE_ROLE_POSTFLIGHT_FAILED';
 end if;
end
$postflight$;
commit;
