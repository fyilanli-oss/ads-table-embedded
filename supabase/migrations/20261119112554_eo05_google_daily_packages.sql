begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Google normal first-day publication only. Existing Klaviyo functions are untouched.

create or replace function evidence.commit_google_dataset_source(o jsonb,p_attempt uuid,p_ordinal integer,p jsonb,r jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare w uuid:=(o->>'workspaceId')::uuid; iid bigint:=(o->>'installationId')::bigint; g bigint:=(o->>'generation')::bigint;
 ctx jsonb; prior evidence.source_batches%rowtype; receipt jsonb; input_hash text; k text; allowed text[]; multipart boolean; package_count integer;
begin
 multipart:=coalesce(r ? 'packageCount',false);
 package_count:=case when multipart and jsonb_typeof(r->'packageCount')='number' and coalesce(r->>'packageCount','') ~ '^([2-9]|1[0-9]|20)$' then (r->>'packageCount')::int else 1 end;
 if multipart and (package_count=1 or r->>'dataset' not in ('account_performance','product_performance')
  or p->>'sourceState' is distinct from 'partial'
  or coalesce(r->>'pageCount','') !~ '^[1-9][0-9]{0,2}$' or (r->>'pageCount')::int>300
  or coalesce(r->>'recordCount','') !~ '^[0-9]{1,5}$' or (r->>'recordCount')::int>20000
  or jsonb_typeof(r->'families') is distinct from 'array') then raise exception 'GOOGLE_DATASET_PACKAGE_INVALID';end if;
 if o->>'provider' is distinct from 'google_ads' or (p_ordinal is null or p_ordinal<0 or p_ordinal>=package_count)
 or jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>(case when multipart then 13 else 9 end)
 or not r ?& array['jobId','fence','window','observedAt','operationId','quotaContext','completedAt','deadlineAt','dataset']
 or coalesce(r->>'dataset','') not in ('account_performance','product_performance','merchant_identity')
 or coalesce(p->>'sourceState','') not in ('complete','partial') or p_attempt is null
 or (r->>'operationId')::uuid is null then raise exception 'GOOGLE_DATASET_BINDING_INVALID';end if;
 foreach k in array array['orders','lines','journeys','claims','rules','mappings','links'] loop
  if jsonb_array_length(p->k) is distinct from 0 then raise exception 'GOOGLE_DATASET_FAMILY_INVALID';end if;
 end loop;
 allowed:=case r->>'dataset'
 when 'account_performance' then array['account_identity','campaign_context','ad_group_channel_daily','search_ad_channel_daily','pmax_asset_group_channel_daily',
  'search_ad_conversion_action_daily','shopping_ad_group_conversion_action_daily','pmax_asset_group_conversion_action_daily','conversion_action_daily']
 when 'product_performance' then array['shopping_product_daily','pmax_product_daily','cart_data_product_sales_daily','shopping_cart_data_product_sales_daily',
  'search_cart_data_product_sales_daily','pmax_cart_data_product_sales_daily','pmax_listing_tree_current','pmax_product_group_aggregate_daily']
 else array['google_merchant_link','merchant_products','google_merchant_status'] end;
 if jsonb_typeof(p->'pages') is distinct from 'array' or jsonb_array_length(p->'pages') not between 1 and 100
 or exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'origin' is distinct from 'google_ads'
  or not (x->>'family'=any(allowed)) or x->>'captureLayer' is distinct from 'native_response_projection'
  or x->>'schemaVersion' is distinct from 'google-raw-datasets-v2'
  or x->>'sanitizerVersion' is distinct from 'google-query-fields-v1'
  or x->>'numericFidelity' is distinct from 'lossless_token') then raise exception 'GOOGLE_DATASET_FAMILY_INVALID';end if;
 if multipart then
  if exists(select 1 from unnest(allowed) f where not (r->'families' ? f)) or jsonb_array_length(r->'families')<>cardinality(allowed) then raise exception 'GOOGLE_DATASET_INCOMPLETE';end if;
 elsif r->>'dataset'<>'merchant_identity' then
  if p->>'sourceState'<>'complete' or exists(select 1 from unnest(allowed) f where not exists
   (select 1 from jsonb_array_elements(p->'pages') x where x->>'family'=f)) then raise exception 'GOOGLE_DATASET_INCOMPLETE';end if;
 else
  if not exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'family'='google_merchant_link')
   or (p->>'sourceState'='complete' and not exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'family'='merchant_products'))
   or (p->>'sourceState'='partial' and not exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'family'='google_merchant_status'))
   then raise exception 'GOOGLE_DATASET_INCOMPLETE';end if;
 end if;
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 perform 1 from operations.refresh_quota_contexts where workspace_id=w and install_generation=g and provider='google_ads' for share;
 perform 1 from billing.workspace_subscriptions where workspace_id=w and installation_id=iid and install_generation=g for share;
 perform 1 from billing.workspace_entitlements where workspace_id=w and install_generation=g for share;
 ctx:=operations.load_refresh_quota_context(w,g,'google_ads',o->>'accountId',r->>'jobId',(r->>'fence')::bigint,
  (r->'window'->>'from')::date,(r->'window'->>'to')::date,'google_ads',(r->>'observedAt')::timestamptz);
 if ctx is null or ctx is distinct from r->'quotaContext'
 or (r->>'completedAt')::timestamptz<(r->>'observedAt')::timestamptz
 or (r->>'completedAt')::timestamptz>clock_timestamp()
 or (r->>'deadlineAt')::timestamptz<=clock_timestamp()
 or (r->>'deadlineAt')::timestamptz>clock_timestamp()+interval '10 minutes'
 or (r->>'dataset'='merchant_identity' and p->>'sourceState'='complete' and ctx->'merchant' is null)
 then raise exception 'GOOGLE_DATASET_READ_NOT_CURRENT';end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||p_attempt::text||p_ordinal::text,0));
 input_hash:=evidence.source_hash(p);
 select * into prior from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and attempt_id=p_attempt and batch_ordinal=p_ordinal;
 if found then
  if prior.authority is distinct from o or prior.manifest->>'googleDatasetInputDigest' is distinct from input_hash
   or prior.manifest->'googleDatasetRead' is distinct from r then raise exception 'GOOGLE_DATASET_OPERATION_CONFLICT';end if;
  return evidence.read_source_receipt(o,p_attempt,p_ordinal);
 end if;
 receipt:=evidence.commit_source_batch(o,p_attempt,p_ordinal,p);
 update evidence.source_batches set manifest=manifest||jsonb_build_object('googleDatasetRead',r,'googleDatasetInputDigest',input_hash)
 where id=(receipt->>'batchId')::bigint and workspace_id=w and installation_id=iid and installation_generation=g;
 if (r->>'deadlineAt')::timestamptz<=clock_timestamp() then raise exception 'GOOGLE_DATASET_READ_EXPIRED';end if;
 return evidence.read_source_receipt(o,p_attempt,p_ordinal);
end $fn$;
revoke all on function evidence.commit_google_dataset_source(jsonb,uuid,integer,jsonb,jsonb)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Prove full raw family/page/reference coverage; individual pieces stay partial.
create function evidence.assert_google_daily_packages(o jsonb,j text,f bigint,day date,ids jsonb) returns void
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype;r jsonb;first_read jsonb;attempt uuid;n integer:=0;pages integer:=0;records integer:=0;families jsonb;
begin
 perform evidence.assert_source_owner(o);
 if o->>'provider' is distinct from 'google_ads' or jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids) not between 2 and 20
 or (select count(distinct value) from jsonb_array_elements_text(ids))<>jsonb_array_length(ids) then raise exception 'GOOGLE_DATASET_PACKAGE_INVALID';end if;
 for b in select * from evidence.source_batches where authority=o and id in(select value::bigint from jsonb_array_elements_text(ids)) order by batch_ordinal for update loop
  r:=b.manifest->'googleDatasetRead';first_read:=coalesce(first_read,r);attempt:=coalesce(attempt,b.attempt_id);
  if b.batch_ordinal<>n or b.attempt_id<>attempt or r is distinct from first_read or b.source_state<>'partial'
   or b.storage_state<>'committed' or b.handoff_state<>'pending' or b.retain_until<=clock_timestamp()
   or b.manifest->'privacyRedacted'='true'::jsonb or r->>'jobId' is distinct from j or r->>'fence' is distinct from f::text
   or r->'window' is distinct from jsonb_build_object('from',day,'to',day)
   or r->>'dataset' not in ('account_performance','product_performance') then raise exception 'GOOGLE_DATASET_PACKAGE_INVALID';end if;
  pages:=pages+(select count(*) from evidence.source_pages where batch_id=b.id);
  records:=records+(select count(*) from evidence.source_references x join evidence.source_pages p on p.id=x.page_id where p.batch_id=b.id);
  n:=n+1;
 end loop;
 select jsonb_agg(family order by family) into families from(select distinct family from evidence.source_pages where batch_id in(select value::bigint from jsonb_array_elements_text(ids))) x;
 if n<>jsonb_array_length(ids) or n is distinct from (first_read->>'packageCount')::int
  or pages is distinct from (first_read->>'pageCount')::int or records is distinct from (first_read->>'recordCount')::int
  or families is distinct from first_read->'families' then raise exception 'GOOGLE_DATASET_PACKAGE_INCOMPLETE';end if;
end $fn$;
revoke all on function evidence.assert_google_daily_packages(jsonb,text,bigint,date,jsonb) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;

create function analytics.google_daily_json(p jsonb,depth integer default 0) returns text
language plpgsql immutable set search_path='' as $fn$
declare result text;
begin
 if depth>32 then raise exception 'DATASET_JSON_BOUNDS';end if;
 if jsonb_typeof(p)='object' then
  if exists(select 1 from jsonb_object_keys(p) as keys(k) where length(k) not between 1 and 512 or k !~ '^[ -~]+$' or k ~* 'token|secret|password|authorization|cookie|email|phone|address|customer|profile|__proto__|constructor|prototype') then raise exception 'DATASET_PRIVATE_FIELD';end if;
  select '{'||coalesce(string_agg(to_jsonb(k)::text||':'||analytics.google_daily_json(v,depth+1),',' order by k collate "C"),'')||'}' into result from jsonb_each(p) as entries(k,v);
 elsif jsonb_typeof(p)='array' then
  select '['||coalesce(string_agg(analytics.google_daily_json(v,depth+1),',' order by ordinal),'')||']' into result from jsonb_array_elements(p) with ordinality as entries(v,ordinal);
 else result:=p::text;end if;
 if octet_length(result)>1048576 then raise exception 'DATASET_JSON_BOUNDS';end if;
 return result;
end $fn$;
revoke all on function analytics.google_daily_json(jsonb,integer) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;
create function analytics.google_daily_digest(p jsonb) returns text language sql immutable strict set search_path='' as $fn$ select encode(sha256(convert_to(analytics.google_daily_json(p),'UTF8')),'hex') $fn$;
revoke all on function analytics.google_daily_digest(jsonb) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;

create function analytics.assert_google_daily_report_claim(o jsonb,c jsonb,d timestamptz) returns void
language plpgsql security definer set search_path='' as $fn$
declare
  workspace uuid := (o->>'workspaceId')::uuid;
  generation bigint := (o->>'generation')::bigint;
  account text := o->>'accountId';
  job text := c->'sourceContext'->>'job_id';
  claim_fence bigint := (c->'sourceContext'->>'fence')::bigint;
  day date := (c->>'businessDate')::date;
begin
  if o->>'provider' is distinct from 'google_ads' or d is null or d<=clock_timestamp()
    or operations.refresh_claim_is_current(workspace,generation,'google_ads',account,job,claim_fence) is not true
    or not exists (
      select 1 from operations.refresh_work_bindings b
      join operations.refresh_work_progress s on s.fence=b.fence and s.workspace_id=b.workspace_id
        and s.install_generation=b.install_generation and s.provider=b.provider and s.account_id=b.account_id and s.job_id=b.job_id
      where b.workspace_id=workspace and b.install_generation=generation and b.provider='google_ads'
        and b.account_id=account and b.job_id=job and b.fence=claim_fence
        and b.from_date=day and b.to_date=day and s.from_date=day and s.to_date=day
        and s.stage='ready_for_dataset' and b.source=c->'sourceContext'->'snapshot'
        and extract(epoch from d)*1000<=b.deadline_at_ms
    ) then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;
end $fn$;

revoke all on function analytics.assert_google_daily_report_claim(jsonb,jsonb,timestamptz)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function analytics.stage_google_daily_report_package(
  o jsonb, p jsonb, c jsonb, d timestamptz, ordinal integer, package_count integer
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  operation uuid := (p->>'operationId')::uuid;
  staged_count integer;
  row_count integer;
  binding text;
  package_digest text;
  staging_relation oid;
begin
  perform evidence.assert_source_owner(o);
  if o->>'provider' is distinct from 'google_ads' or operation is null
    or package_count is null or package_count not between 1 and 20
    or ordinal is null or ordinal<0 or ordinal>=package_count
    or jsonb_typeof(p) is distinct from 'object' or p->>'version' is distinct from 'eo05b-storage-v1'
    or jsonb_typeof(p->'rows') is distinct from 'array' then
    raise exception 'GOOGLE_REPORT_PACKAGE_INVALID';
  end if;
  row_count:=jsonb_array_length(p->'rows');
  if (row_count not between 1 and 200 and not (row_count=0 and package_count=1 and ordinal=0))
    or octet_length(analytics.google_daily_json(jsonb_build_object('write',p,'context',c)))>1048576 then
    raise exception 'GOOGLE_REPORT_PACKAGE_LIMIT';
  end if;
  perform analytics.assert_google_daily_report_claim(o,c,d);

  staging_relation:=pg_catalog.to_regclass('pg_temp.adstable_google_daily_report_stage');
  if staging_relation is null and ordinal=0 then
    create temporary table pg_temp.adstable_google_daily_report_stage (
      package_ordinal integer primary key,
      day_binding text not null,
      body jsonb not null,
      digest text not null,
      daily_sources_verified boolean not null default false
    ) on commit drop;
    staging_relation:=pg_catalog.to_regclass('pg_temp.adstable_google_daily_report_stage');
  end if;
  if not exists (select 1 from pg_catalog.pg_class
    where oid=staging_relation and relnamespace=pg_catalog.pg_my_temp_schema()
      and relowner=current_user::regrole and relpersistence='t' and relkind='r') then
    raise exception 'GOOGLE_REPORT_STAGE_REQUIRED';
  end if;
  binding:=analytics.google_daily_digest(jsonb_build_object(
    'owner',o,'context',c,'deadline',d,'operationId',operation,'policy',p->'policy','packageCount',package_count));
  select count(*) into staged_count from pg_temp.adstable_google_daily_report_stage;
  if staged_count<>ordinal or exists (select 1 from pg_temp.adstable_google_daily_report_stage where day_binding<>binding) then
    raise exception 'GOOGLE_REPORT_PACKAGE_SEQUENCE';
  end if;
  package_digest:=analytics.google_daily_digest(jsonb_build_object('write',p,'context',c));
  insert into pg_temp.adstable_google_daily_report_stage (package_ordinal,day_binding,body,digest)
  values (ordinal,binding,p,package_digest);
  return jsonb_build_object('status','staged','operationId',operation,'ordinal',ordinal,
    'packageCount',package_count,'rowCount',row_count,'digest',package_digest);
end $fn$;

revoke all on function analytics.stage_google_daily_report_package(jsonb,jsonb,jsonb,timestamptz,integer,integer)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function analytics.verify_google_daily_report_stage(
  o jsonb, c jsonb, d timestamptz, operation uuid, policy jsonb, digests jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  package_count integer;
  row_count integer;
  binding text;
  packages jsonb;
  summary jsonb;
begin
  perform evidence.assert_source_owner(o);
  if o->>'provider' is distinct from 'google_ads' or d is null or d<=clock_timestamp()
    or operation is null or jsonb_typeof(digests) is distinct from 'array' then
    raise exception 'GOOGLE_REPORT_PACKAGE_INVALID';
  end if;
  package_count:=jsonb_array_length(digests);
  if package_count not between 1 and 20
    or exists(select 1 from jsonb_array_elements(digests) value
      where jsonb_typeof(value) is distinct from 'string' or (value#>>'{}') !~ '^[0-9a-f]{64}$') then
    raise exception 'GOOGLE_REPORT_PACKAGE_INVALID';
  end if;
  if not exists (select 1 from pg_catalog.pg_class
    where oid=pg_catalog.to_regclass('pg_temp.adstable_google_daily_report_stage')
      and relnamespace=pg_catalog.pg_my_temp_schema() and relowner=current_user::regrole
      and relpersistence='t' and relkind='r') then
    raise exception 'GOOGLE_REPORT_STAGE_REQUIRED';
  end if;
  binding:=analytics.google_daily_digest(jsonb_build_object(
    'owner',o,'context',c,'deadline',d,'operationId',operation,'policy',policy,'packageCount',package_count));
  if (select count(*) from pg_temp.adstable_google_daily_report_stage)<>package_count
    or exists(select 1 from pg_temp.adstable_google_daily_report_stage s
      where s.package_ordinal not between 0 and package_count-1 or s.day_binding<>binding
        or s.digest is distinct from digests->>s.package_ordinal
        or s.digest is distinct from analytics.google_daily_digest(jsonb_build_object('write',s.body,'context',c))) then
    raise exception 'GOOGLE_REPORT_PACKAGE_VERIFICATION_FAILED';
  end if;
  if exists(
    select 1 from pg_temp.adstable_google_daily_report_stage s
    cross join lateral jsonb_array_elements(s.body->'rows') item
    group by item->>'table',item->'row'->>'native_key_hash'
    having count(*)>1 or coalesce(item->'row'->>'native_key_hash','') !~ '^[0-9a-f]{64}$'
  ) then raise exception 'GOOGLE_REPORT_PACKAGE_ROW_IDENTITY_INVALID'; end if;
  select sum(jsonb_array_length(body->'rows'))::integer,
    jsonb_agg(jsonb_build_object('ordinal',package_ordinal,'rowCount',jsonb_array_length(body->'rows'),'digest',digest)
      order by package_ordinal)
    into row_count,packages
    from pg_temp.adstable_google_daily_report_stage;
  summary:=jsonb_build_object('status','stage_verified','operationId',operation,'rowCount',row_count,
    'packageCount',package_count,'packages',packages,'consumerReceipt',false,'checkpointAdvanced',false);
  return summary||jsonb_build_object('digest',analytics.google_daily_digest(summary));
end $fn$;

revoke all on function analytics.verify_google_daily_report_stage(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function analytics.google_report_fact_matches(t text,actual jsonb,expected jsonb)
returns boolean language plpgsql stable set search_path='' as $fn$
declare
  payload jsonb;
  field_name text;
  prepared_fields text[]:=array['native_key_canonical','native_key_hash','grain_version','row_schema_version','payload_digest'];
begin
  if t not in ('pd_facts','cpd_product_performance_facts','cpd_product_sales_facts') or actual is null or expected is null then return false; end if;
  -- Normalize the same database representations used by reconciliation_fact_digest.
  payload:=actual-prepared_fields-array['id','workspace_id','installation_id','installation_generation',
    'provider_connection_id','platform','platform_account_id','canonical_reporting_account_id','revision',
    'created_at','updated_at','retention_policy_version','retain_until'];
  for field_name in select attname::text from pg_catalog.pg_attribute where attrelid=('analytics.'||t)::regclass
    and atttypid in ('numeric'::regtype,'bigint'::regtype) and attnum>0 and not attisdropped loop
    if payload ? field_name and payload->field_name<>'null'::jsonb then
      payload:=jsonb_set(payload,array[field_name],to_jsonb(payload->>field_name));
    end if;
  end loop;
  if payload->>'occurred_at' is not null then
    payload:=jsonb_set(payload,'{occurred_at}',to_jsonb(to_char((payload->>'occurred_at')::timestamptz
      at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  end if;
  -- The package writer already validated the digest of the exact expected
  -- payload. Equality with that payload rechecks every physical field.
  return payload=expected-prepared_fields;
end $fn$;

revoke all on function analytics.google_report_fact_matches(text,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function analytics.check_google_daily_report_facts(
  o jsonb, c jsonb, d timestamptz, operation uuid, policy jsonb, digests jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  summary jsonb;
  item jsonb;
  fact jsonb;
  table_name text;
  day date := (c->>'businessDate')::date;
  total integer:=0;
  n integer;
  w uuid := (o->>'workspaceId')::uuid;
  i bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
begin
  -- Take the existing scheduled-writer lock only at the physical day check,
  -- after all package transfers. A later handoff must share this transaction.
  perform 1 from operations.refresh_control where singleton for update;
  if not found then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;
  perform analytics.assert_google_daily_report_claim(o,c,d);
  summary:=analytics.verify_google_daily_report_stage(o,c,d,operation,policy,digests);
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    execute format('select count(*)::int from (select id from analytics.%I where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''google_ads'' and platform_account_id=$4 and business_date=$5 limit 4001) actual',table_name)
      into n using w,i,g,a,day;
    total:=total+n;
  end loop;
  if total<>(summary->>'rowCount')::integer then raise exception 'GOOGLE_REPORT_FACT_READBACK_MISMATCH'; end if;
  for item in
    select value from pg_temp.adstable_google_daily_report_stage s
    cross join lateral jsonb_array_elements(s.body->'rows')
  loop
    table_name:=item->>'table';
    if table_name not in ('pd_facts','cpd_product_performance_facts','cpd_product_sales_facts') or table_name is null then
      raise exception 'GOOGLE_REPORT_FACT_READBACK_MISMATCH';
    end if;
    execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''google_ads'' and platform_account_id=$4 and business_date=$5 and grain_version=$6 and native_key_hash=$7 for share',table_name)
      into fact using w,i,g,a,day,item->'row'->>'grain_version',item->'row'->>'native_key_hash';
    if fact is null or fact->>'provider_connection_id' is distinct from o->>'connectionId'
      or fact->>'native_key_canonical' is distinct from item->'row'->>'native_key_canonical'
      or (fact->>'retain_until')::timestamptz<=clock_timestamp()
      or fact->>'payload_digest' is distinct from item->'row'->>'payload_digest'
      or analytics.google_report_fact_matches(table_name,fact,item->'row') is not true then
      raise exception 'GOOGLE_REPORT_FACT_READBACK_MISMATCH';
    end if;
  end loop;
  if d<=clock_timestamp() then raise exception 'DATASET_RECONCILIATION_DEADLINE'; end if;
  summary:=(summary-'digest')||jsonb_build_object('comparison','matched','status','facts_verified');
  return summary||jsonb_build_object('digest',analytics.google_daily_digest(summary));
end $fn$;

revoke all on function analytics.check_google_daily_report_facts(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function analytics.write_google_staged_first_report_day(
  o jsonb, c jsonb, d timestamptz, operation uuid, policy jsonb, digests jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  s record;
  row_body jsonb;
  written jsonb;
  table_name text;
  has_facts boolean;
  day date := (c->>'businessDate')::date;
  w uuid := (o->>'workspaceId')::uuid;
  i bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not found then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;
  perform analytics.assert_google_daily_report_claim(o,c,d);
  perform analytics.verify_google_daily_report_stage(o,c,d,operation,policy,digests);
  if c->'expectedRevision' is distinct from '0'::jsonb
    or exists(select 1 from evidence.source_batches b where b.workspace_id=w and b.installation_id=i
      and b.installation_generation=g and b.primary_source='google_ads' and b.authority=o
      and b.manifest->'datasetReconciliation'->>'businessDate'=c->>'businessDate') then
    raise exception 'GOOGLE_REPORT_FIRST_DAY_REQUIRED';
  end if;
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    execute format('select exists(select 1 from analytics.%I where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''google_ads'' and platform_account_id=$4 and business_date=$5)',table_name)
      into has_facts using w,i,g,a,day;
    if has_facts then raise exception 'GOOGLE_REPORT_FIRST_DAY_REQUIRED'; end if;
  end loop;
  for s in select body from pg_temp.adstable_google_daily_report_stage order by package_ordinal loop
    for row_body in select value->'row' from jsonb_array_elements(s.body->'rows') loop
      if row_body->>'business_date' is distinct from day::text
        or row_body->'provenance'->'source_context' is distinct from c->'sourceContext' then
        raise exception 'GOOGLE_REPORT_PACKAGE_SCOPE_INVALID';
      end if;
    end loop;
    -- Reuse the bounded physical writer, retention rules and row triggers.
    if jsonb_array_length(s.body->'rows')=0 then continue;end if;
    written:=analytics.commit_google_daily_package(o,s.body||jsonb_build_object('operationId',gen_random_uuid()));
    if written->>'status' is distinct from 'stored'
      or jsonb_array_length(written->'rows') is distinct from jsonb_array_length(s.body->'rows') then
      raise exception 'GOOGLE_REPORT_PACKAGE_WRITE_INVALID';
    end if;
  end loop;
  return analytics.check_google_daily_report_facts(o,c,d,operation,policy,digests);
end $fn$;

revoke all on function analytics.write_google_staged_first_report_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function analytics.google_daily_report_fingerprint(o jsonb,d date,tz text,expected integer,verified_in_tx boolean default false) returns text
language plpgsql security definer set search_path='' as $fn$
declare
  fact jsonb;
  payload_digest text;
  table_name text;
  leaves text[]:='{}';
  w uuid := (o->>'workspaceId')::uuid;
  i bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint;
begin
  perform evidence.assert_source_owner(o);
  if o->>'provider' is distinct from 'google_ads' or d is null or tz is null
    or expected is null or expected not between 0 and 4000 then raise exception 'GOOGLE_REPORT_FACT_READBACK_MISMATCH'; end if;
  foreach table_name in array array['pd_facts','cpd_product_performance_facts','cpd_product_sales_facts'] loop
    for fact in execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=''google_ads'' and platform_account_id=$4 and business_date=$5 order by native_key_hash collate "C" limit 4001',table_name)
      using w,i,g,o->>'accountId',d
    loop
      if cardinality(leaves)>=expected or fact->>'source_timezone' is distinct from tz
        or fact->>'provider_connection_id' is distinct from o->>'connectionId'
        or (fact->>'retain_until')::timestamptz<=clock_timestamp() then raise exception 'GOOGLE_REPORT_FACT_READBACK_MISMATCH'; end if;
      payload_digest:=case when verified_in_tx then fact->>'payload_digest' else analytics.reconciliation_fact_digest(table_name,fact) end;
      if fact->>'payload_digest' is distinct from payload_digest then raise exception 'GOOGLE_REPORT_FACT_READBACK_MISMATCH'; end if;
      leaves:=array_append(leaves,analytics.google_daily_digest(jsonb_build_array(table_name,fact->>'native_key_hash',payload_digest)));
    end loop;
  end loop;
  if cardinality(leaves)<>expected then raise exception 'GOOGLE_REPORT_FACT_READBACK_MISMATCH'; end if;
  return analytics.google_daily_digest(to_jsonb(leaves));
end $fn$;

revoke all on function analytics.google_daily_report_fingerprint(jsonb,date,text,integer,boolean)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function analytics.inspect_google_daily_report(o jsonb,op uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  b evidence.source_batches%rowtype;
  receipt jsonb;
  ref jsonb;
begin
  perform evidence.assert_source_owner(o);
  select * into b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid
    and installation_id=(o->>'installationId')::bigint and installation_generation=(o->>'generation')::bigint
    and authority=o and manifest->'googleDailyReceipt'->>'operationId'=op::text for share;
  if not found then return null; end if;
  receipt:=b.manifest->'googleDailyReceipt';
  if b.storage_state<>'committed' or b.retain_until<=clock_timestamp()
    or b.manifest->'privacyRedacted'='true'::jsonb
    or receipt->>'digest' is distinct from analytics.google_daily_digest(receipt-'digest') then
    raise exception 'GOOGLE_REPORT_RECEIPT_INVALID';
  end if;
  if b.manifest ? 'datasetSupersededBy' then
    return receipt||jsonb_build_object('status','superseded','checkpointAdvanced',false);
  end if;
  for ref in select value from jsonb_array_elements(receipt->'sources') loop
    perform analytics.assert_dataset_source(o,ref);
    if not exists(select 1 from evidence.source_batches x where x.id=(ref->>'batch_id')::bigint and x.authority=o
      and x.handoff_state='consumed' and x.handoff_receipt=receipt->>'digest'
      and x.manifest->'privacyRedacted' is distinct from 'true'::jsonb) then raise exception 'GOOGLE_REPORT_RECEIPT_INVALID'; end if;
  end loop;
  if analytics.google_daily_report_fingerprint(o,(receipt->>'businessDate')::date,receipt->>'timeZone',
    (receipt->>'rowCount')::integer) is distinct from receipt->>'factsDigest' then raise exception 'GOOGLE_REPORT_FACT_READBACK_MISMATCH';end if;
  return receipt;
end $fn$;

revoke all on function analytics.inspect_google_daily_report(jsonb,uuid)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function analytics.finish_google_daily_report_job(o jsonb,j text,f bigint,op uuid,h text)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare
  w uuid := (o->>'workspaceId')::uuid;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
  r jsonb;
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not found then return false; end if;
  perform evidence.assert_source_owner(o);
  if o->>'provider' is distinct from 'google_ads' or op is null or h is null or h !~ '^[0-9a-f]{64}$'
    or operations.refresh_claim_is_current(w,g,'google_ads',a,j,f) is not true then return false; end if;
  r:=analytics.inspect_google_daily_report(o,op);
  if r->>'status' is distinct from 'consumed' or r->>'comparison' is distinct from 'matched'
    or r->'consumerReceipt' is distinct from 'true'::jsonb or r->'checkpointAdvanced' is distinct from 'true'::jsonb
    or r->>'digest' is distinct from h or r->>'jobId' is distinct from j or r->>'fence' is distinct from f::text
    or not exists(select 1 from operations.refresh_work_progress s where s.workspace_id=w and s.install_generation=g
      and s.provider='google_ads' and s.account_id=a and s.job_id=j and s.fence=f and s.stage='ready_for_dataset'
      and s.from_date=(r->>'businessDate')::date and s.to_date=s.from_date)
    or operations.refresh_claim_is_current(w,g,'google_ads',a,j,f) is not true then return false; end if;
  return operations.finish_refresh_work_before_stops(w,g,'google_ads',a,j,f,'completed');
end $fn$;

revoke all on function analytics.finish_google_daily_report_job(jsonb,text,bigint,uuid,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function analytics.commit_google_daily_package(o jsonb,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare item jsonb; r jsonb; row_input jsonb; injected jsonb; b evidence.source_batches%rowtype; primary_id bigint; cached_day date; cached_tz text; cached_until timestamptz;
 operation uuid; h text; prior jsonb; result jsonb; ids jsonb:='[]'; found_row jsonb; rid bigint; name text; cols text; allowed text[]; k text;
 bulk_rows jsonb:='{}'; bulk_ids jsonb:='{}'; stored record;
 staged_google boolean:=false; verified_day_sources boolean:=false; grouped record;
begin
 if o->>'provider' is distinct from 'google_ads' then raise exception 'GOOGLE_REPORT_PROVIDER_INVALID';end if;
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 if o->>'provider'='shopify' or jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>4
 or not p ?& array['version','operationId','policy','rows'] or p->>'version'<>'eo05b-storage-v1'
 or jsonb_typeof(p->'rows') is distinct from 'array' or jsonb_array_length(p->'rows') not between 1 and 200
 or octet_length(analytics.google_daily_json(p))>1048576 then raise exception 'DATASET_INPUT_INVALID';end if;
 operation:=(p->>'operationId')::uuid;
 if jsonb_typeof(p->'policy') is distinct from 'object' or (select count(*) from jsonb_object_keys(p->'policy'))<>2
 or not p->'policy' ?& array['version','until'] or coalesce(p->'policy'->>'version','')=''
 or not coalesce(isfinite((p->'policy'->>'until')::timestamptz) and (p->'policy'->>'until')::timestamptz>clock_timestamp(),false)
 then raise exception 'DATASET_RETENTION_REQUIRED';end if;
 primary_id:=(p->'rows'->0->'row'->>'source_batch_id')::bigint;
 select * into strict b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and id=primary_id for update;
 if b.authority is distinct from o or b.storage_state<>'committed' or b.retain_until<=clock_timestamp() then raise exception 'DATASET_SOURCE_NOT_CURRENT';end if;
 h:=analytics.google_daily_digest(p);prior:=b.manifest->'datasetStorageReceipts'->operation::text;
 if prior is not null then
  if prior->>'digest' is distinct from h then raise exception 'DATASET_OPERATION_CONFLICT';end if;
  if analytics.inspect_dataset_storage(o,primary_id,operation)->>'status' is distinct from 'stored' then raise exception 'DATASET_RECEIPT_INVALIDATED';end if;
  return prior;
 end if;
 if (select count(*) from jsonb_object_keys(coalesce(b.manifest->'datasetStorageReceipts','{}')) )>=32 then raise exception 'DATASET_RECEIPT_CAPACITY';end if;
 -- A private, owner-created stage cannot be spoofed by a caller's temp table.
 if o->>'provider'='google_ads' and exists(select 1 from pg_catalog.pg_class
   where oid=pg_catalog.to_regclass('pg_temp.adstable_google_daily_report_stage')
     and relnamespace=pg_catalog.pg_my_temp_schema() and relowner=current_user::regrole
     and relpersistence='t' and relkind='r') then
  select true,stage.daily_sources_verified into staged_google,verified_day_sources
    from pg_temp.adstable_google_daily_report_stage stage
    where stage.body-'operationId'=p-'operationId' limit 1;
  staged_google:=coalesce(staged_google,false);
  verified_day_sources:=coalesce(verified_day_sources,false);
 end if;
 if p->'policy'->>'version'='report-source-3y-v1' then
  cached_day:=(p->'rows'->0->'row'->>'business_date')::date;cached_tz:=p->'rows'->0->'row'->>'source_timezone';
  cached_until:=analytics.report_retention_until(cached_day,cached_tz);
  if exists(select 1 from privacy.deletion_runs where workspace_id=(o->>'workspaceId')::uuid and install_generation=(o->>'generation')::bigint and status in ('pending','running','failed')) then raise exception 'REPORT_RETENTION_PRIVACY_PENDING';end if;
  for item in select value from jsonb_array_elements(p->'rows') loop
   r:=item->'row';
   if (case when (r->>'business_date')::date=cached_day and r->>'source_timezone'=cached_tz then cached_until else analytics.report_retention_until((r->>'business_date')::date,r->>'source_timezone') end) is distinct from (p->'policy'->>'until')::timestamptz
    or r->>'business_date' is distinct from r->'provenance'->'source_context'->'window'->>'from'
    or r->>'source_timezone' is distinct from r->'provenance'->'source_context'->'snapshot'->>'timezone'
   then raise exception 'REPORT_RETENTION_POLICY_MISMATCH';end if;
   if not staged_google then
    perform analytics.assert_report_source_context(o,r->'provenance'->'source_context',(p->'policy'->>'until')::timestamptz,r->'provenance'->'sources');
    for k in select distinct x->>'batch_id' from jsonb_array_elements(r->'provenance'->'sources') x loop
     perform analytics.hold_report_source_batch(o,k::bigint,(p->'policy'->>'until')::timestamptz);
    end loop;
   end if;
   foreach k in array array['product_mapping_id','sold_product_mapping_id','advertised_product_mapping_id'] loop
    if r->>k is not null then perform analytics.hold_report_mapping(o,(r->>k)::bigint,(p->'policy'->>'until')::timestamptz);end if;
   end loop;
  end loop;
  if staged_google and not verified_day_sources then
   -- Verify the same context and page references and retain each source once
   -- per package. Individual scopes, mapping holds and row triggers remain.
   for grouped in
    select entry.value->'row'->'provenance'->'source_context' context,
      jsonb_agg(distinct refs.value) pages
    from jsonb_array_elements(p->'rows') entry
    cross join lateral jsonb_array_elements(entry.value->'row'->'provenance'->'sources') refs
    group by 1
   loop
    perform analytics.assert_report_source_context(o,grouped.context,(p->'policy'->>'until')::timestamptz,grouped.pages);
   end loop;
   for k in select distinct refs.value->>'batch_id' from jsonb_array_elements(p->'rows') entry
    cross join lateral jsonb_array_elements(entry.value->'row'->'provenance'->'sources') refs loop
    perform analytics.hold_report_source_batch(o,k::bigint,(p->'policy'->>'until')::timestamptz);
   end loop;
  end if;
 end if;
 if (select count(*) from jsonb_array_elements(p->'rows'))<>(select count(distinct (value->>'table',value->'row'->>'native_key_hash')) from jsonb_array_elements(p->'rows'))
 then raise exception 'DATASET_DUPLICATE_NATIVE_KEY';end if;
 for item in select value from jsonb_array_elements(p->'rows') loop
  name:=item->>'table';r:=item->'row';
  if name not in ('pd_facts','cpd_product_performance_facts','cpd_product_sales_facts') or name is null
  or jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>2 or not item ?& array['table','row']
  or jsonb_typeof(r) is distinct from 'object' then raise exception 'DATASET_TABLE_INVALID';end if;
  select array_agg(attname::text order by attnum) into allowed from pg_catalog.pg_attribute where attrelid=('analytics.'||name)::regclass and attnum>0 and not attisdropped
  and attname not in ('id','workspace_id','installation_id','installation_generation','provider_connection_id','platform','platform_account_id','canonical_reporting_account_id','revision','created_at','updated_at','retention_policy_version','retain_until');
  if (select count(*) from jsonb_object_keys(r))<>cardinality(allowed) or not r ?& allowed then raise exception 'DATASET_ROW_SHAPE_INVALID';end if;
  for k in select attname::text from pg_catalog.pg_attribute where attrelid=('analytics.'||name)::regclass and atttypid='numeric'::regtype and attnum>0 loop
   if r->k<>'null'::jsonb and (jsonb_typeof(r->k)<>'string' or length(r->>k)>128 or r->>k !~ '^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$') then raise exception 'DATASET_DECIMAL_INVALID';end if;
  end loop;
  row_input:=r-array['native_key_canonical','native_key_hash','grain_version','row_schema_version','payload_digest'];
  if r->>'payload_digest' is distinct from analytics.google_daily_digest(row_input) then raise exception 'DATASET_PAYLOAD_DIGEST_INVALID';end if;
  injected:=r||jsonb_build_object('workspace_id',o->>'workspaceId','installation_id',o->>'installationId','installation_generation',o->>'generation',
   'provider_connection_id',o->>'connectionId','platform',o->>'provider','platform_account_id',o->>'accountId',
   'canonical_reporting_account_id',o->>'accountId',
   'retention_policy_version',p->'policy'->>'version','retain_until',p->'policy'->>'until');
  if staged_google then
   bulk_rows:=jsonb_set(bulk_rows,array[name],coalesce(bulk_rows->name,'[]')||jsonb_build_array(injected));
   continue;
  end if;
  -- Serialize all accepted writes against current installation/control authority.
  -- Different content is a conflict; EO05C/D correction is never guessed here.
  execute format('select to_jsonb(x) from analytics.%I x where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and platform=$4 and platform_account_id=$5 and grain_version=$6 and native_key_hash=$7 for update',name)
   into found_row using (o->>'workspaceId')::uuid,(o->>'installationId')::bigint,(o->>'generation')::bigint,o->>'provider',o->>'accountId',r->>'grain_version',r->>'native_key_hash';
  if found_row is not null then
   if found_row->>'native_key_canonical' is distinct from r->>'native_key_canonical' or found_row->>'payload_digest' is distinct from r->>'payload_digest'
   or (found_row->>'retain_until')::timestamptz<=clock_timestamp() then raise exception 'DATASET_NATIVE_CONFLICT';end if;
   if p->'policy'->>'version'='report-source-3y-v1' and (found_row->>'retention_policy_version' is distinct from 'report-source-3y-v1' or (found_row->>'retain_until')::timestamptz is distinct from (p->'policy'->>'until')::timestamptz) then raise exception 'DATASET_RETENTION_POLICY_CONFLICT';end if;
   rid:=(found_row->>'id')::bigint;
  else
   select string_agg(quote_ident(key),',' order by key) into cols from jsonb_object_keys(injected) key;
   execute format('insert into analytics.%I(%s) select %s from jsonb_populate_record(null::analytics.%I,$1) returning id',name,cols,cols,name) into rid using injected;
  end if;
  ids:=ids||jsonb_build_array(jsonb_build_object('table',name,'id',rid::text,'nativeKeyHash',r->>'native_key_hash'));
 end loop;
 if staged_google then
  -- Table names and input columns come from the checks above. Keep the existing
  -- per-row triggers and receipt semantics while issuing one insert per table.
  for name in select jsonb_object_keys(bulk_rows) order by 1 loop
   select string_agg(quote_ident(key),',' order by key) into cols from jsonb_object_keys(bulk_rows->name->0) key;
   for stored in execute format($bulk$
    with incoming as materialized (
     select * from jsonb_populate_recordset(null::analytics.%1$I,$1)
    ), existing as materialized (
     select target.id,target.native_key_hash,
      target.native_key_canonical is distinct from candidate.native_key_canonical
        or target.payload_digest is distinct from candidate.payload_digest
        or target.retain_until<=clock_timestamp() as native_conflict,
      target.retention_policy_version is distinct from candidate.retention_policy_version
        or target.retain_until is distinct from candidate.retain_until as retention_conflict
     from analytics.%1$I target join incoming candidate
      using (workspace_id,installation_id,installation_generation,platform,platform_account_id,grain_version,native_key_hash)
     for update of target
    ), inserted as (
     insert into analytics.%1$I (%2$s)
     select %2$s from incoming candidate
     where not exists(select 1 from existing prior where prior.native_key_hash=candidate.native_key_hash)
       and not exists(select 1 from existing prior where prior.native_conflict or ($2 and prior.retention_conflict))
     returning id,native_key_hash
    )
    select id,native_key_hash,native_conflict,retention_conflict from existing
    union all
    select id,native_key_hash,false,false from inserted
   $bulk$,name,cols) using bulk_rows->name,p->'policy'->>'version'='report-source-3y-v1'
   loop
    if stored.native_conflict then raise exception 'DATASET_NATIVE_CONFLICT';end if;
    if p->'policy'->>'version'='report-source-3y-v1' and stored.retention_conflict then raise exception 'DATASET_RETENTION_POLICY_CONFLICT';end if;
    bulk_ids:=bulk_ids||jsonb_build_object(name||':'||stored.native_key_hash,stored.id::text);
   end loop;
  end loop;
  if (select count(*) from jsonb_object_keys(bulk_ids))<>jsonb_array_length(p->'rows') then
   raise exception 'GOOGLE_REPORT_FACT_READBACK_MISMATCH';
  end if;
  -- Return the stored IDs in the same order as the bounded input package.
  select jsonb_agg(jsonb_build_object('table',entry.value->>'table',
    'id',bulk_ids->>((entry.value->>'table')||':'||(entry.value->'row'->>'native_key_hash')),
    'nativeKeyHash',entry.value->'row'->>'native_key_hash') order by entry.ordinality)
   into ids from jsonb_array_elements(p->'rows') with ordinality entry;
 end if;
 result:=jsonb_build_object('status','stored','operationId',operation,'digest',h,'rows',ids,'consumerReceipt',false);
 update evidence.source_batches set manifest=jsonb_set(manifest,'{datasetStorageReceipts}',coalesce(manifest->'datasetStorageReceipts','{}')||jsonb_build_object(operation::text,result)) where id=primary_id;
 return result;
end $fn$;

revoke all on function analytics.commit_google_daily_package(jsonb,jsonb) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;

create function analytics.publish_google_staged_report_day(o jsonb,c jsonb,d timestamptz,operation uuid,policy jsonb,digests jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype;r jsonb;v text;kind text;ids jsonb;proof jsonb;receipt jsonb;anchor bigint;
 day date:=(c->>'businessDate')::date;tz text:=c->'sourceContext'->'snapshot'->>'timezone';raw_operation text;completed timestamptz;groups integer:=0;
begin
 perform 1 from operations.refresh_control where singleton for update;
 perform analytics.assert_google_daily_report_claim(o,c,d);
 perform analytics.verify_google_daily_report_stage(o,c,d,operation,policy,digests);
 if c->'expectedRevision' is distinct from '0'::jsonb or policy->>'version' is distinct from 'report-source-3y-v1'
 or jsonb_typeof(c->'batchIds') is distinct from 'array' or jsonb_array_length(c->'batchIds') not between 2 and 41
 or c->'sourceContext'->'window' is distinct from jsonb_build_object('from',day,'to',day)
 or (select count(distinct value) from jsonb_array_elements_text(c->'batchIds'))<>jsonb_array_length(c->'batchIds')
 or (select count(distinct value->>'page_id') from jsonb_array_elements(c->'sources'))<>jsonb_array_length(c->'sources')
 or exists(select 1 from jsonb_array_elements(c->'sources') ref where not(c->'batchIds' ? (ref->>'batch_id')))
 or exists(select 1 from evidence.source_batches where authority=o and (manifest->'googleDailyReceipt'->>'businessDate'=day::text
  or manifest->'datasetReconciliation'->>'businessDate'=day::text or manifest->'googleDailyReceipt'->>'operationId'=operation::text))
 then raise exception 'GOOGLE_REPORT_FIRST_DAY_REQUIRED';end if;
 perform analytics.assert_report_source_context(o,c->'sourceContext',(policy->>'until')::timestamptz,c->'sources');
 perform id from evidence.source_batches where authority=o and id in(select value::bigint from jsonb_array_elements_text(c->'batchIds')) order by id for update;
 for v in select value from jsonb_array_elements_text(c->'batchIds') loop
  select * into strict b from evidence.source_batches where id=v::bigint and authority=o;
  r:=b.manifest->'googleDatasetRead';raw_operation:=coalesce(raw_operation,r->>'operationId');
  if b.storage_state<>'committed' or b.handoff_state<>'pending' or b.retain_until<=clock_timestamp()
   or b.manifest->'privacyRedacted'='true'::jsonb or b.manifest ? 'datasetReconciliationMismatch'
   or r->>'jobId' is distinct from c->'sourceContext'->>'job_id' or r->>'fence' is distinct from c->'sourceContext'->>'fence'
   or r->'window' is distinct from c->'sourceContext'->'window' or r->>'operationId' is distinct from raw_operation
   or r->>'completedAt' is null or (r->>'completedAt')::timestamptz>clock_timestamp()
   or (select count(*) from evidence.source_pages where batch_id=b.id)<>(select count(*) from jsonb_array_elements(c->'sources') ref where ref->>'batch_id'=v)
  then raise exception 'GOOGLE_REPORT_SOURCE_INVALID';end if;
  completed:=greatest(completed,(r->>'completedAt')::timestamptz);
  if r->>'dataset' not in ('account_performance','product_performance','merchant_identity') or r->>'dataset' is null then raise exception 'GOOGLE_REPORT_SOURCE_INVALID';end if;
 end loop;
 foreach kind in array array['account_performance','product_performance','merchant_identity'] loop
  select jsonb_agg(id::text order by batch_ordinal) into ids from evidence.source_batches where authority=o
   and id in(select value::bigint from jsonb_array_elements_text(c->'batchIds')) and manifest->'googleDatasetRead'->>'dataset'=kind;
  if ids is null then
   if kind<>'merchant_identity' then raise exception 'GOOGLE_REPORT_SOURCE_INVALID';end if;
   continue;
  end if;
  groups:=groups+1;
  if jsonb_array_length(ids)>1 then
   perform evidence.assert_google_daily_packages(o,c->'sourceContext'->>'job_id',(c->'sourceContext'->>'fence')::bigint,day,ids);
  elsif not exists(select 1 from evidence.source_batches where id=(ids->>0)::bigint and source_state='complete'
    and not (manifest->'googleDatasetRead' ? 'packageCount')) then raise exception 'GOOGLE_REPORT_SOURCE_INVALID';end if;
  if kind='account_performance' then anchor:=(ids->>0)::bigint;end if;
 end loop;
 if groups<2 then raise exception 'GOOGLE_REPORT_SOURCE_INVALID';end if;
 if exists(select 1 from pg_temp.adstable_google_daily_report_stage s cross join lateral jsonb_array_elements(s.body->'rows') item
  where item->'row'->'provenance'->'source_context' is distinct from c->'sourceContext'
   or jsonb_typeof(item->'row'->'provenance'->'sources') is distinct from 'array'
   or not(c->'sources' @> (item->'row'->'provenance'->'sources'))) then raise exception 'GOOGLE_REPORT_SOURCE_INVALID';end if;
 for v in select value from jsonb_array_elements_text(c->'batchIds') loop
  perform analytics.hold_report_source_batch(o,v::bigint,(policy->>'until')::timestamptz);
 end loop;
 update pg_temp.adstable_google_daily_report_stage set daily_sources_verified=true;
 proof:=analytics.write_google_staged_first_report_day(o,c,d,operation,policy,digests);
 receipt:=jsonb_build_object('version','google-daily-receipt-v1','operationId',operation,'status','consumed','comparison','matched',
  'consumerReceipt',true,'checkpointAdvanced',true,'businessDate',day,'timeZone',tz,'revision',1,'completedAt',completed,
  'rowCount',proof->'rowCount','packages',proof->'packages','batchIds',c->'batchIds','sources',c->'sources',
  'jobId',c->'sourceContext'->>'job_id','fence',c->'sourceContext'->>'fence',
  'factsDigest',analytics.google_daily_report_fingerprint(o,day,tz,(proof->>'rowCount')::int,true));
 receipt:=receipt||jsonb_build_object('digest',analytics.google_daily_digest(receipt));
 if octet_length(receipt::text)>262144 or d<=clock_timestamp() then raise exception 'GOOGLE_REPORT_RECEIPT_INVALID';end if;
 update evidence.source_batches set handoff_state='consumed',handoff_receipt=receipt->>'digest',
  manifest=manifest||jsonb_build_object('datasetConsumerReceipt',jsonb_build_object('operationId',operation,'anchorBatchId',anchor::text,'digest',receipt->>'digest'))
  where authority=o and id in(select value::bigint from jsonb_array_elements_text(c->'batchIds'));
 update evidence.source_batches set manifest=manifest||jsonb_build_object('googleDailyReceipt',receipt) where id=anchor and authority=o;
 if exists(select 1 from evidence.source_batches where authority=o and id in(select value::bigint from jsonb_array_elements_text(c->'batchIds'))
   and octet_length(manifest::text)>1048576) then raise exception 'GOOGLE_REPORT_RECEIPT_INVALID';end if;
 return receipt;
end $fn$;
revoke all on function analytics.publish_google_staged_report_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function analytics.stage_google_daily_report_package(jsonb,jsonb,jsonb,timestamptz,integer,integer),
 analytics.publish_google_staged_report_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb),
 analytics.inspect_google_daily_report(jsonb,uuid),analytics.finish_google_daily_report_job(jsonb,text,bigint,uuid,text)
 to adstable_refresh_dataset_runner;
reset role;
commit;
