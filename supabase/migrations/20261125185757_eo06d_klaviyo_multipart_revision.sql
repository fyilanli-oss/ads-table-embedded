begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- A physical source part remains partial. Revision permission exists only
-- while publishing the verified group, and only for its exact staged row.
create function analytics.klaviyo_staged_revision_allowed(o jsonb,m jsonb,p jsonb,j jsonb,t text) returns boolean
language plpgsql security invoker set search_path='' as $fn$
declare scope jsonb:=j->'provenance'->'source_context';
begin
  if o->>'provider' is distinct from 'klaviyo' or t is distinct from 'cpd_product_sales_facts'
    or j->>'platform' is distinct from 'klaviyo' or p->>'transactionId' is distinct from pg_catalog.txid_current()::text
    or p->>'table' is distinct from t or p->>'id' is distinct from j->>'id'
    or p->>'toRevision' is distinct from j->>'revision' or p->>'after' is distinct from j->>'payload_digest'
    or p->>'dailyOperation' is null or p->>'dailyBinding' is null
    or coalesce(p->>'stageOrdinal','') !~ '^([0-9]|1[0-9])$'
    or j->>'workspace_id' is distinct from o->>'workspaceId' or j->>'installation_id' is distinct from o->>'installationId'
    or j->>'installation_generation' is distinct from o->>'generation'
    or j->>'provider_connection_id' is distinct from o->>'connectionId' or j->>'platform_account_id' is distinct from o->>'accountId'
    or m->>'dataset' is distinct from 'product_performance'
    or jsonb_typeof(m->'packageCount') is distinct from 'number'
    or m->>'jobId' is distinct from scope->>'job_id' or m->>'fence' is distinct from scope->>'fence'
    or m->'window' is distinct from scope->'window' then return false;
  end if;
  if (m->>'packageCount')::int not between 2 and 20 then return false; end if;
  if not exists(select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('pg_temp.adstable_klaviyo_daily_report_stage')
    and relnamespace=pg_catalog.pg_my_temp_schema() and relowner=current_user::regrole and relpersistence='t' and relkind='r')
    then return false;
  end if;
  return exists(
    select 1 from pg_temp.adstable_klaviyo_daily_report_stage s
    cross join lateral jsonb_array_elements(s.body->'rows') e
    where s.package_ordinal=(p->>'stageOrdinal')::int and s.daily_sources_verified
      and s.day_binding=p->>'dailyBinding' and s.body->>'operationId'=p->>'dailyOperation'
      and e->>'table'=t and e->'row'->>'native_key_hash'=j->>'native_key_hash'
      and e->'row'->>'payload_digest'=p->>'after'
      and e->'row'->'provenance'->'source_context'=scope
      and analytics.klaviyo_report_fact_matches(t,j,e->'row')
  );
end $fn$;

revoke all on function analytics.klaviyo_staged_revision_allowed(jsonb,jsonb,jsonb,jsonb,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;

create or replace function analytics.validate_dataset_fact() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare j jsonb:=to_jsonb(new); b evidence.source_batches%rowtype; o jsonb; ref jsonb; m identity.product_identity_mappings%rowtype;
 f analytics.fx_rates%rowtype; k text; keys text[]; expected jsonb; identity_kind text; native jsonb; all_complete boolean:=true; context jsonb; original_source jsonb; native_read jsonb; permit jsonb;
begin
 if tg_op='UPDATE' then
  select coalesce(manifest->'datasetRevisionPermit',
    case new.platform when 'google_ads' then manifest->'googleDailyRevisionPermits'->(tg_table_name||':'||old.id::text)
     when 'meta' then manifest->'metaDailyRevisionPermits'->(tg_table_name||':'||old.id::text) end)
   into permit from evidence.source_batches where workspace_id=new.workspace_id and installation_id=new.installation_id
   and installation_generation=new.installation_generation and id=new.source_batch_id and storage_state='committed'
   and handoff_state='pending'
   and (source_state='complete' or (
    source_state='partial' and new.platform='google_ads' and primary_source='google_ads'
    and manifest->'googleDatasetRead' ? 'packageCount'
    and manifest->'googleDailyRevisionPermits'->(tg_table_name||':'||old.id::text)->'googleVerifiedPackage'=
      jsonb_build_object('jobId',new.provenance->'source_context'->>'job_id',
        'fence',new.provenance->'source_context'->>'fence',
        'window',new.provenance->'source_context'->'window')
    and manifest->'googleDatasetRead'->>'jobId'=new.provenance->'source_context'->>'job_id'
    and manifest->'googleDatasetRead'->>'fence'=new.provenance->'source_context'->>'fence'
    and manifest->'googleDatasetRead'->'window'=new.provenance->'source_context'->'window')
    or (source_state='partial' and new.platform='klaviyo' and primary_source='klaviyo'
      and analytics.klaviyo_staged_revision_allowed(authority,manifest->'klaviyoDatasetRead',
        manifest->'datasetRevisionPermit',j,tg_table_name)));
  if permit is null or permit->>'transactionId' is distinct from pg_catalog.txid_current()::text or permit->>'table' is distinct from tg_table_name
   or permit->>'id' is distinct from new.id::text or permit->>'fromRevision' is distinct from old.revision::text
   or permit->>'toRevision' is distinct from new.revision::text or new.revision<>old.revision+1
   or permit->>'before' is distinct from old.payload_digest or permit->>'after' is distinct from new.payload_digest
   or new.workspace_id is distinct from old.workspace_id or new.installation_id is distinct from old.installation_id
   or new.installation_generation is distinct from old.installation_generation or new.provider_connection_id is distinct from old.provider_connection_id
   or new.platform is distinct from old.platform or new.platform_account_id is distinct from old.platform_account_id
   or new.native_key_canonical is distinct from old.native_key_canonical or new.native_key_hash is distinct from old.native_key_hash
   or new.business_date is distinct from old.business_date or new.source_timezone is distinct from old.source_timezone or new.created_at is distinct from old.created_at
  then raise exception 'DATASET_REVISION_PROTOCOL_REQUIRED';end if;
 end if;
 select * into strict b from evidence.source_batches where workspace_id=new.workspace_id and installation_id=new.installation_id
 and installation_generation=new.installation_generation and id=new.source_batch_id for share;
 o:=b.authority; perform evidence.assert_source_owner(o);
 if o->>'provider'='shopify' or new.platform is distinct from o->>'provider' or new.platform_account_id is distinct from o->>'accountId'
 or new.provider_connection_id::text is distinct from o->>'connectionId'
 or new.retain_until>b.retain_until or new.retain_until<=clock_timestamp() then raise exception 'DATASET_OWNER_OR_POLICY_INVALID';end if;
 if new.platform<>'klaviyo' and new.canonical_reporting_account_id is distinct from o->>'accountId' then raise exception 'DATASET_ACCOUNT_INVALID';end if;
 if octet_length(analytics.dataset_json(j))>65536 or jsonb_typeof(new.provenance->'sources') is distinct from 'array'
 or jsonb_array_length(new.provenance->'sources') not between 1 and 32
 or (select count(*) from jsonb_object_keys(new.provenance))<>2+(case when new.provenance ? 'source_context' then 1 else 0 end)+(case when new.provenance ? 'reporting_currency' then 2 else 0 end)
 or (new.provenance ? 'reporting_currency') is distinct from (new.provenance ? 'fx_policy')
 or not new.provenance ?& array['projection_version','sources'] or coalesce(new.provenance->>'projection_version','')=''
 then raise exception 'DATASET_PROVENANCE_INVALID';end if;
 if new.provenance ? 'source_context' then
  context:=new.provenance->'source_context';
  if jsonb_typeof(context) is distinct from 'object' or (select count(*) from jsonb_object_keys(context))<>6
  or not context ?& array['version','snapshot','digest','job_id','fence','window'] or context->>'version'<>'eo05b-source-context-v1'
  then raise exception 'DATASET_CONTEXT_INVALID';end if;
  select source into original_source from operations.refresh_work_bindings where workspace_id=new.workspace_id and install_generation=new.installation_generation
   and provider=new.platform and account_id=new.platform_account_id and job_id=context->>'job_id' and fence=(context->>'fence')::bigint
   and from_date=(context->'window'->>'from')::date and to_date=(context->'window'->>'to')::date for share;
  if not found or original_source is distinct from context->'snapshot' or evidence.source_hash(original_source) is distinct from context->>'digest'
  or original_source->>'currency' is distinct from new.source_currency or original_source->>'timezone' is distinct from new.source_timezone
  or original_source->>'connectionId' is distinct from new.provider_connection_id::text
  or original_source->>'connectionVersion' is distinct from o->>'connectionVersion'
  or context->'window'->>'from' is distinct from context->'window'->>'to'
  or (new.business_date is not null and new.business_date::text is distinct from context->'window'->>'from')
  then raise exception 'DATASET_CONTEXT_MISMATCH';end if;
  for ref in select value from jsonb_array_elements(new.provenance->'sources') loop
   select manifest->(case new.platform when 'google_ads' then 'googleDatasetRead' when 'meta' then 'metaDatasetRead' else 'klaviyoDatasetRead' end) into native_read
   from evidence.source_batches where workspace_id=new.workspace_id and installation_id=new.installation_id and installation_generation=new.installation_generation and id=(ref->>'batch_id')::bigint;
   if native_read is null or native_read->>'jobId' is distinct from context->>'job_id' or native_read->>'fence' is distinct from context->>'fence'
   or native_read->'window' is distinct from context->'window' then raise exception 'DATASET_CONTEXT_SOURCE_MISMATCH';end if;
  end loop;
 end if;
 if new.provenance ? 'reporting_currency' or new.fx_engine_version='frankfurter-ecb-weekend-v1' then perform analytics.assert_dataset_fx_context(to_jsonb(new));end if;
 for ref in select value from jsonb_array_elements(new.provenance->'sources') loop
  perform analytics.assert_dataset_source(o,ref);
  if exists(select 1 from evidence.source_batches x where x.id=(ref->>'batch_id')::bigint and x.source_state<>'complete') then all_complete:=false;end if;
  if exists(select 1 from evidence.source_batches x where x.id=(ref->>'batch_id')::bigint and x.retain_until<new.retain_until) then raise exception 'DATASET_SOURCE_POLICY_INVALID';end if;
 end loop;
 if new.source_completeness is distinct from (case when all_complete then 'complete' else 'partial' end) then raise exception 'DATASET_COMPLETENESS_INVALID';end if;
 if not exists(select 1 from jsonb_array_elements(new.provenance->'sources') r where r->>'batch_id'=new.source_batch_id::text)
 then raise exception 'DATASET_PRIMARY_SOURCE_REQUIRED';end if;
 -- Registry changes replace this validator; the tables retain their generic
 -- same-grain JSONB shape and do not need a new per-provider column/table.
 if new.extension_schema_version<>'eo05b-extensions-v1' or new.metric_extensions<>'{}'::jsonb
 or (select count(*) from jsonb_object_keys(new.metric_extensions))>32 then raise exception 'DATASET_EXTENSION_UNREGISTERED';end if;
 keys:=case tg_table_name when 'pd_facts' then array['impression','ad_click','spend_value','add_to_cart','add_to_cart_value','checkout','checkout_value','purchase','purchase_value']
 when 'cpd_product_performance_facts' then array['impression','click','spend_value'] else array['sales_quantity','sales_value'] end;
 if (select count(*) from jsonb_object_keys(new.metric_support))<>cardinality(keys)
 or (select count(*) from jsonb_object_keys(new.observation_state))<>cardinality(keys)
 or not new.metric_support ?& keys or not new.observation_state ?& keys then raise exception 'DATASET_METRIC_STATE_INVALID';end if;
 foreach k in array keys loop
  if not coalesce(new.metric_support->>k in ('supported','unsupported','unknown') and new.observation_state->>k in ('present','missing','unknown','unsupported'),false) then raise exception 'DATASET_METRIC_STATE_INVALID';end if;
  if new.metric_support->>k='unsupported' and new.observation_state->>k<>'unsupported' then raise exception 'DATASET_METRIC_STATE_INVALID';end if;
 end loop;
 identity_kind:=new.source_identity->>'kind';native:=new.source_identity->'native';
 if jsonb_typeof(native) is distinct from 'object' or native='{}' or (select count(*) from jsonb_object_keys(native))>16
 or (select count(*) from jsonb_object_keys(new.source_identity))<>3 or not new.source_identity ?& array['kind','namespace','native']
 or coalesce(new.source_identity->>'namespace','')='' or identity_kind not in ('daily','event') or identity_kind is null
 or exists(select 1 from jsonb_each(native) where key !~ '^[a-z][a-z0-9_]{0,63}$' or key ~ 'amount|value|name|mapping|role|channel|currency|version|epoch|connection|credential|job|attempt|receipt|cursor'
 or key not in ('entity_type','entity_id','campaign_id','ad_group_id','asset_group_id','merchant_id','catalog_id','feed_label','language','product_id','sold_product_id','advertised_product_id','event_id')
 or jsonb_typeof(value) not in ('string','null')) then raise exception 'DATASET_IDENTITY_INVALID';end if;
 if (tg_table_name='pd_facts' and (native->>'entity_id' is distinct from j->>'entity_id' or native->>'entity_type' is distinct from j->>'entity_type'))
 or (tg_table_name='cpd_product_performance_facts' and native->>'product_id' is distinct from j->>'native_product_id')
 or (tg_table_name='cpd_product_sales_facts' and identity_kind='daily' and native->>'sold_product_id' is distinct from j->>'native_sold_product_id')
 or (identity_kind='event' and new.platform<>'klaviyo') then raise exception 'DATASET_IDENTITY_INVALID';end if;
 expected:=jsonb_build_array(new.grain_version,new.workspace_id::text,new.installation_id::text,new.installation_generation::text,new.platform,new.platform_account_id,tg_table_name,
 identity_kind,new.source_identity->>'namespace',native);
 if identity_kind='daily' then
  if new.source_identity->>'namespace' is distinct from (case tg_table_name when 'pd_facts' then 'entity_performance' when 'cpd_product_performance_facts' then 'product_performance' else 'product_sales' end) then raise exception 'DATASET_IDENTITY_INVALID';end if;
  if new.business_date is null or coalesce(new.source_timezone,'')='' or new.reporting_scope='{}' then raise exception 'DATASET_DAILY_SCOPE_REQUIRED';end if;
  expected:=expected||jsonb_build_array(new.business_date::text,new.source_timezone,new.reporting_scope,new.source_currency);
 else
  if tg_table_name<>'cpd_product_sales_facts' or new.source_identity->>'namespace'<>'ordered_product' or (select count(*) from jsonb_object_keys(native))<>1
  or coalesce(native->>'event_id','')='' or native->>'event_id' is distinct from j->>'provider_event_id'
  then raise exception 'DATASET_EVENT_IDENTITY_INVALID';end if;
 end if;
 if new.native_key_canonical is distinct from analytics.dataset_json(expected) or new.native_key_hash is distinct from analytics.dataset_digest(expected)
 then raise exception 'DATASET_KEY_INVALID';end if;
 if new.platform='klaviyo' and tg_table_name='cpd_product_sales_facts' and (identity_kind<>'event' or j->>'occurred_at' is null)
 then raise exception 'DATASET_EVENT_TIME_REQUIRED';end if;
 foreach k in array array['product_mapping_id','sold_product_mapping_id','advertised_product_mapping_id'] loop
  if j->>k is not null then
   select * into strict m from identity.product_identity_mappings where workspace_id=new.workspace_id and installation_id=new.installation_id
   and installation_generation=new.installation_generation and id=(j->>k)::bigint for share;
   if m.mapping_state<>'verified' or m.source_rule_version_id is null or m.native_context is distinct from j->'product_context'
   or m.native_product_id is distinct from j->>(case k when 'product_mapping_id' then 'native_product_id' when 'sold_product_mapping_id' then 'native_sold_product_id' else 'native_advertised_product_id' end)
   then raise exception 'DATASET_MAPPING_INVALID';end if;
   perform identity.mapping_review_state(o,m.id,m.source_rule_version_id,false);
  end if;
 end loop;
 if new.fx_state='verified' then
  select * into strict f from analytics.fx_rates where id=new.fx_rate_id for share;
  if f.fx_provider='frankfurter_ecb_v2' and not new.provenance ? 'reporting_currency' then raise exception 'DATASET_FX_PROOF_REQUIRED';end if;
  if f.source_currency is distinct from new.source_currency or f.target_currency is distinct from new.target_currency
  or f.fx_rate_date is distinct from (case when new.provenance ? 'fx_policy' then analytics.dataset_fx_publication_date(new.business_date) else new.business_date end) or coalesce(new.fx_engine_version,'')='' then raise exception 'DATASET_FX_CONTEXT_INVALID';end if;
 end if;
 return new;
end $fn$;

create or replace function analytics.replace_klaviyo_staged_report_day(
  o jsonb,c jsonb,d timestamptz,operation uuid,policy jsonb,digests jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  s record;
  item jsonb;
  r jsonb;
  old_fact jsonb;
  written jsonb;
  table_name text;
  allowed text[];
  assignments text;
  staged_keys jsonb;
  source_id bigint;
  day date := (c->>'businessDate')::date;
  w uuid := (o->>'workspaceId')::uuid;
  i bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
begin
  perform analytics.plan_klaviyo_staged_report_replacement(o,c,d,operation,policy,digests);
  if exists(select 1 from pg_temp.adstable_klaviyo_daily_report_stage where not daily_sources_verified) then
    raise exception 'KLAVIYO_REPORT_RECEIPT_SCOPE_INVALID';
  end if;
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    select coalesce(jsonb_object_agg(entry.value->'row'->>'native_key_hash',true),'{}'::jsonb)
      into staged_keys from pg_temp.adstable_klaviyo_daily_report_stage staged
      cross join lateral jsonb_array_elements(staged.body->'rows') entry
      where entry.value->>'table'=table_name;
    execute format('delete from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''klaviyo'' and platform_account_id=$4 and business_date=$5
      and not ($6 ? x.native_key_hash)',table_name)
      using w,i,g,a,day,staged_keys;
  end loop;
  for s in select body,day_binding,package_ordinal from pg_temp.adstable_klaviyo_daily_report_stage order by package_ordinal loop
    for item in select value from jsonb_array_elements(s.body->'rows') loop
      table_name:=item->>'table';
      r:=item->'row';
      if table_name is null or table_name not in ('pd_facts','cpd_product_sales_facts')
        or r->>'business_date' is distinct from day::text
        or r->'provenance'->'source_context' is distinct from c->'sourceContext' then
        raise exception 'KLAVIYO_REPORT_PACKAGE_SCOPE_INVALID';
      end if;
      execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''klaviyo'' and platform_account_id=$4 and grain_version=$5 and native_key_hash=$6 for update',table_name)
        into old_fact using w,i,g,a,r->>'grain_version',r->>'native_key_hash';
      if old_fact is null then continue; end if;
      if old_fact->>'native_key_canonical' is distinct from r->>'native_key_canonical'
        or old_fact->>'business_date' is distinct from day::text
        or old_fact->>'source_timezone' is distinct from r->>'source_timezone'
        or old_fact->>'provider_connection_id' is distinct from o->>'connectionId'
        or (old_fact->>'retain_until')::timestamptz<=clock_timestamp() then
        raise exception 'DATASET_RECONCILIATION_KEY_CONFLICT';
      end if;
      select array_agg(attname::text),string_agg(format('%I=v.%I',attname,attname),',')
        into allowed,assignments from pg_catalog.pg_attribute
        where attrelid=('analytics.'||table_name)::regclass and attnum>0 and not attisdropped
          and attname not in ('id','workspace_id','installation_id','installation_generation','provider_connection_id',
            'platform','platform_account_id','canonical_reporting_account_id','revision','created_at','updated_at',
            'retention_policy_version','retain_until');
      if (select count(*) from jsonb_object_keys(r))<>cardinality(allowed) or not r ?& allowed
        or r->>'payload_digest' is distinct from analytics.dataset_digest(r-array['native_key_canonical','native_key_hash','grain_version','row_schema_version','payload_digest']) then
        raise exception 'DATASET_ROW_SHAPE_INVALID';
      end if;
      -- Publication has already verified and retained all of this day's source batches.
      source_id:=(r->>'source_batch_id')::bigint;
      update evidence.source_batches set manifest=manifest||jsonb_build_object('datasetRevisionPermit',jsonb_build_object(
        'transactionId',pg_catalog.txid_current()::text,'dailyOperation',operation::text,'dailyBinding',s.day_binding,
        'stageOrdinal',s.package_ordinal,'table',table_name,'id',old_fact->>'id',
        'fromRevision',old_fact->>'revision','toRevision',((old_fact->>'revision')::bigint+1)::text,
        'before',old_fact->>'payload_digest','after',r->>'payload_digest'))
        where id=source_id and authority=o and handoff_state='pending';
      if not found then raise exception 'DATASET_REVISION_PROTOCOL_REQUIRED'; end if;
      execute format('update analytics.%I x set %s,revision=x.revision+1,updated_at=clock_timestamp(),
        retention_policy_version=$3,retain_until=$4 from jsonb_populate_record(null::analytics.%I,$1) v where x.id=$2',
        table_name,assignments,table_name) using r,(old_fact->>'id')::bigint,policy->>'version',(policy->>'until')::timestamptz;
      update evidence.source_batches set manifest=manifest-'datasetRevisionPermit' where id=source_id and authority=o;
    end loop;
    written:=analytics.commit_dataset_storage(o,s.body||jsonb_build_object('operationId',gen_random_uuid()));
    if written->>'status' is distinct from 'stored'
      or jsonb_array_length(written->'rows') is distinct from jsonb_array_length(s.body->'rows') then
      raise exception 'KLAVIYO_REPORT_PACKAGE_WRITE_INVALID';
    end if;
  end loop;
  return analytics.check_klaviyo_daily_report_facts(o,c,d,operation,policy,digests);
end $fn$;

reset role;
commit;
