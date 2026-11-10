begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Operational metadata on existing source manifests. No new Dataset family,
-- route, credential, role, provider setting or report-value upsert is introduced.
create function evidence.maturity_policy(p jsonb) returns jsonb
language plpgsql stable set search_path='' as $fn$
declare n jsonb:=p->'native'; a jsonb; label text; h integer:=null; v integer; valid boolean:=true;
 seen text[]:='{}'; windows integer[]:='{}'; reason text;
begin
 if p->>'version' is distinct from 'eo05c-maturity-v1' or coalesce(p->>'provider','') not in ('google_ads','meta','klaviyo')
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p->>'timeZone') then raise exception 'MATURITY_POLICY_INVALID';end if;
 if p->>'provider'='google_ads' and n->'complete'='true'::jsonb and jsonb_typeof(n->'before')='array'
 and jsonb_array_length(n->'before') between 1 and 20000 and n->'before'=n->'after' then
  for a in select value from jsonb_array_elements(n->'before') loop
   if coalesce(a->>'resource','')!~ '^customers/[0-9]+/conversionActions/[0-9]+$' or a->>'resource'=any(seen)
   or coalesce(a->>'status','') not in ('ENABLED','HIDDEN','REMOVED')
   or coalesce(a->>'category','') not in ('ADD_TO_CART','BEGIN_CHECKOUT','PURCHASE')
   or coalesce(a->>'model','')!~ '^[A-Z][A-Z_]+$' or a->>'model' in ('UNKNOWN','UNSPECIFIED')
   or coalesce(a->>'counting','')!~ '^[A-Z][A-Z_]+$' or a->>'counting' in ('UNKNOWN','UNSPECIFIED')
   or coalesce(a->>'click_days','')!~ '^(0|[1-9][0-9]{0,2})$' or coalesce(a->>'view_days','')!~ '^(0|[1-9][0-9]{0,2})$'
   then valid:=false;continue;end if;
   seen:=array_append(seen,a->>'resource');
   if (a->>'click_days')::int>90 or (a->>'view_days')::int>30 then valid:=false;end if;
   if a->>'status'='ENABLED' then windows:=windows||array[(a->>'click_days')::int,(a->>'view_days')::int];end if;
  end loop;
 elsif p->>'provider'='meta' and n->'complete'='true'::jsonb and jsonb_typeof(n->'settings')='array'
 and jsonb_array_length(n->'settings') between 1 and 20000 then
  for a in select value from jsonb_array_elements(n->'settings') loop
   if coalesce(a->>'ad_id','')!~ '^[1-9][0-9]*$' or a->>'ad_id'=any(seen) or jsonb_typeof(a->'setting') is distinct from 'string'
   then valid:=false;continue;end if;
   seen:=array_append(seen,a->>'ad_id');
   if (select count(*) from unnest(string_to_array(a->>'setting',',')) x)<>(select count(distinct btrim(x)) from unnest(string_to_array(a->>'setting',',')) x) then valid:=false;end if;
   for label in select btrim(x) from unnest(string_to_array(a->>'setting',',')) x loop
    if label!~ '^((1|7|28)d_(click|view)|1d_ev)$' then valid:=false;
    else windows:=array_append(windows,split_part(label,'d_',1)::int);end if;
   end loop;
  end loop;
 end if;
 if valid and cardinality(windows)>0 then select max(x) into h from unnest(windows) x;end if;
 reason:=case when h is not null then null when p->>'provider'='klaviyo' then 'account_attribution_not_observed' else 'native_settings_unverified' end;
 return jsonb_build_object('version','eo05c-maturity-v1','state',case when h is null then 'unknown' else 'known' end,
 'horizonDays',h,'reason',reason,'fingerprint',analytics.dataset_digest(jsonb_build_object('version','eo05c-maturity-v1','provider',p->>'provider','timeZone',p->>'timeZone','native',n)),'timeZone',p->>'timeZone');
end $fn$;

create function evidence.register_maturity_configuration(o jsonb,a uuid,p jsonb,d timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype; page evidence.source_pages%rowtype; policy jsonb; result jsonb; m jsonb;
begin
 perform evidence.assert_source_owner(o);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('eo05c:'||o::text,0));
 if d is null or not isfinite(d) or d<=clock_timestamp() or d>clock_timestamp()+interval '120 seconds'
 or a is null or p->>'provider' is distinct from o->>'provider' or octet_length(p::text)>1048576
 or coalesce(p->>'observedAt','')!~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
 or (p->>'observedAt')::timestamptz>clock_timestamp() or (p->>'observedAt')::timestamptz<clock_timestamp()-interval '60 seconds'
 then raise exception 'MATURITY_CONFIGURATION_INVALID';end if;
 policy:=evidence.maturity_policy(p);
 if policy is distinct from p->'policy' then raise exception 'MATURITY_POLICY_MISMATCH';end if;
 select * into strict b from evidence.source_batches where authority=o and attempt_id=a and batch_ordinal=0 for update;
 if b.storage_state<>'committed' or b.source_state<>'complete' or b.retain_until<=clock_timestamp()
 or b.manifest->'privacyRedacted'='true'::jsonb or b.manifest ? 'maturityConfiguration'
 or b.manifest->'counts'->>'pages'<>'1' then raise exception 'MATURITY_CONFIGURATION_UNAVAILABLE';end if;
 select * into strict page from evidence.source_pages where batch_id=b.id;
 if page.family<>'maturity_configuration' or page.origin<>o->>'provider' or page.payload_schema_version<>'eo05c-native-configuration-v1'
 or page.sanitizer_version<>'eo05c-attribution-fields-v1' or page.capture_layer<>'collector_projection'
 or page.numeric_fidelity<>'decoded_only' or page.purged_at is not null or page.retain_until<=clock_timestamp()
 -- Encrypted source pages use compact canonical application JSON, unlike the
 -- existing SQL-only receipt hash over PostgreSQL's spaced jsonb rendering.
 or page.payload_hash is distinct from analytics.dataset_digest(p) then raise exception 'MATURITY_CONFIGURATION_PROOF_INVALID';end if;
 result:=jsonb_build_object('batchId',b.id::text,'pageId',page.id::text,'payloadHash',page.payload_hash,'fingerprint',policy->>'fingerprint','policy',policy,'observedAt',p->>'observedAt');
 m:=b.manifest||jsonb_build_object('maturityConfiguration',result);
 if octet_length(m::text)>1048576 or d<=clock_timestamp() then raise exception 'MATURITY_CONFIGURATION_LIMIT';end if;
 update evidence.source_batches set manifest=m where id=b.id;
 return result;
end $fn$;

create function evidence.commit_maturity_decision(o jsonb,p jsonb,d timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare anchor evidence.source_batches%rowtype; cfg evidence.source_batches%rowtype; newest evidence.source_batches%rowtype;
 b evidence.source_batches%rowtype; ref jsonb; r jsonb; read_key text; read_data jsonb; scope jsonb:=null; datasets text[]:='{}'; expected text[];
 policy jsonb; head jsonb; entries jsonb; result jsonb; m jsonb; bid text; op uuid; proof jsonb; report_ok boolean:=false;
 boundary timestamptz; state text; reason text; revision bigint; page_count int:=0; complete boolean:=true; until_time timestamptz;
begin
 perform evidence.assert_source_owner(o);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('eo05c:'||o::text,0));
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>14
 or p->>'version' is distinct from 'eo05c-maturity-v1' or octet_length(p::text)>1048576
 or d is null or not isfinite(d) or d<=clock_timestamp() or d>clock_timestamp()+interval '120 seconds'
 or coalesce(p->>'businessDate','')!~ '^\d{4}-\d\d-\d\d$' or (p->>'businessDate')::date not between date '1900-01-01' and date '9990-12-31'
 or coalesce(p->>'expectedRevision','')!~ '^(0|[1-9][0-9]{0,8})$' or jsonb_typeof(p->'complete') is distinct from 'boolean'
 or jsonb_typeof(p->'reportBatchIds') is distinct from 'array' or jsonb_array_length(p->'reportBatchIds') not between 2 and 3
 or jsonb_typeof(p->'sources') is distinct from 'array' or jsonb_array_length(p->'sources') not between 1 and 300
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p->>'timeZone')
 then raise exception 'MATURITY_DECISION_INVALID';end if;
 op:=(p->>'operationId')::uuid;revision:=(p->>'expectedRevision')::bigint;
 -- Consistent lock order across all referenced batches; no unbounded scan/write.
 perform id from evidence.source_batches where authority=o and (attempt_id=(p->>'anchorAttemptId')::uuid
 or id=(p->>'configurationBatchId')::bigint or id in(select value::text::bigint from jsonb_array_elements_text(p->'reportBatchIds'))) order by id for update;
 select * into strict anchor from evidence.source_batches where authority=o and attempt_id=(p->>'anchorAttemptId')::uuid and batch_ordinal=0;
 select * into strict cfg from evidence.source_batches where authority=o and id=(p->>'configurationBatchId')::bigint;
 select * into newest from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and primary_source=o->>'provider' and authority=o and storage_state='committed' and manifest ? 'maturityConfiguration'
 order by (manifest->'maturityConfiguration'->>'observedAt') COLLATE "C" desc,id desc limit 1;
 if newest.id is null or newest.manifest->'maturityConfiguration'->>'fingerprint' is distinct from p->>'policyFingerprint'
 or cfg.manifest->'maturityConfiguration'->>'fingerprint' is distinct from p->>'policyFingerprint'
 then raise exception 'MATURITY_CONFIGURATION_CHANGED';end if;
 perform analytics.assert_dataset_source(o,jsonb_build_object('batch_id',newest.id::text,'commit_id',newest.commit_id::text,'request_digest',newest.request_digest,
 'page_id',newest.manifest->'maturityConfiguration'->>'pageId','payload_hash',newest.manifest->'maturityConfiguration'->>'payloadHash'));
 if anchor.storage_state<>'committed' or anchor.retain_until<=clock_timestamp() or anchor.manifest->'privacyRedacted'='true'::jsonb
 or cfg.storage_state<>'committed' or cfg.retain_until<=clock_timestamp() or cfg.manifest->'privacyRedacted'='true'::jsonb
 or (cfg.manifest->'maturityConfiguration'->>'observedAt')::timestamptz<clock_timestamp()-interval '60 seconds'
 then raise exception 'MATURITY_SOURCE_UNAVAILABLE';end if;
 head:=anchor.manifest->'maturityHead';
 if coalesce((head->>'revision')::bigint,0)<>revision then raise exception 'MATURITY_REVISION_CONFLICT';end if;
 entries:=coalesce(cfg.manifest->'maturityDecisions','{}');
 if jsonb_typeof(entries)<>'object' or entries ? op::text or (select count(*) from jsonb_object_keys(entries))>=200 then raise exception 'MATURITY_OPERATION_USED_OR_FULL';end if;
 policy:=cfg.manifest->'maturityConfiguration'->'policy';
 if policy->>'timeZone' is distinct from p->>'timeZone' then raise exception 'MATURITY_TIMEZONE_MISMATCH';end if;
 -- A deleted/pruned configuration page cannot authorize a decision.
 perform analytics.assert_dataset_source(o,jsonb_build_object('batch_id',cfg.id::text,'commit_id',cfg.commit_id::text,'request_digest',cfg.request_digest,
 'page_id',cfg.manifest->'maturityConfiguration'->>'pageId','payload_hash',cfg.manifest->'maturityConfiguration'->>'payloadHash'));
 read_key:=case o->>'provider' when 'google_ads' then 'googleDatasetRead' when 'meta' then 'metaDatasetRead' when 'klaviyo' then 'klaviyoDatasetRead' end;
 if read_key is null then raise exception 'MATURITY_PROVIDER_INVALID';end if;
 if anchor.manifest->read_key->'window' is distinct from jsonb_build_object('from',p->>'businessDate','to',p->>'businessDate') then raise exception 'MATURITY_ANCHOR_DATE_MISMATCH';end if;
 for bid in select value from jsonb_array_elements_text(p->'reportBatchIds') loop
  select * into strict b from evidence.source_batches where authority=o and id=bid::bigint;
  read_data:=b.manifest->read_key;
  if b.storage_state<>'committed' or b.retain_until<=clock_timestamp() or b.manifest->'privacyRedacted'='true'::jsonb
  or read_data->'window' is distinct from jsonb_build_object('from',p->>'businessDate','to',p->>'businessDate')
  or read_data->>'dataset'=any(datasets) then raise exception 'MATURITY_REPORT_SOURCE_INVALID';end if;
  datasets:=array_append(datasets,read_data->>'dataset');
  r:=jsonb_build_object('jobId',read_data->>'jobId','fence',read_data->>'fence','operationId',read_data->>'operationId');
  if scope is not null and scope<>r then raise exception 'MATURITY_READ_SCOPE_MISMATCH';end if;scope:=r;
  if not exists(select 1 from operations.refresh_work_bindings x where x.workspace_id=(o->>'workspaceId')::uuid
   and x.install_generation=(o->>'generation')::bigint and x.provider=o->>'provider' and x.account_id=o->>'accountId'
   and x.job_id=read_data->>'jobId' and x.fence=(read_data->>'fence')::bigint
   and x.from_date=(p->>'businessDate')::date and x.to_date=x.from_date
   and x.source->>'timezone'=p->>'timeZone' and x.source->>'connectionId'=o->>'connectionId'
   and x.source->>'connectionVersion'=o->>'connectionVersion') then raise exception 'MATURITY_ADMISSION_MISMATCH';end if;
  if b.source_state<>'complete' then complete:=false;end if;
  page_count:=page_count+(b.manifest->'counts'->>'pages')::int;
  if read_data->>'observedAt'<p->>'startedAt' or read_data->>'completedAt'>p->>'completedAt' then raise exception 'MATURITY_READ_CLOCK_MISMATCH';end if;
  if p->'reportOperationId'<>'null'::jsonb then
   if b.manifest->'datasetStorageReceipts' ? (p->>'reportOperationId') then
    proof:=analytics.inspect_dataset_storage(o,b.id,(p->>'reportOperationId')::uuid);
    report_ok:=report_ok or (proof->>'status'='stored');
   elsif b.manifest->'datasetEmptyRetentionReceipts' ? (p->>'reportOperationId') then
    proof:=analytics.inspect_dataset_empty_retention(o,b.id,(p->>'reportOperationId')::uuid);
    report_ok:=report_ok or (proof->>'status'='retained_empty');
   end if;
  end if;
 end loop;
 expected:=case when o->>'provider'='klaviyo' then array['account_performance','configuration','product_performance'] else array['account_performance','product_performance'] end;
 if (select array_agg(x order by x) from unnest(datasets) x) is distinct from expected
 or page_count<>jsonb_array_length(p->'sources') or (select count(distinct value->>'page_id') from jsonb_array_elements(p->'sources'))<>page_count
 then raise exception 'MATURITY_COVERAGE_INVALID';end if;
 for ref in select value from jsonb_array_elements(p->'sources') loop
  if not (p->'reportBatchIds' ? (ref->>'batch_id')) then raise exception 'MATURITY_REFERENCE_SCOPE_INVALID';end if;
  perform analytics.assert_dataset_source(o,ref);
 end loop;
 if coalesce(p->>'startedAt','')!~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
 or coalesce(p->>'completedAt','')!~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
 or (p->>'completedAt')::timestamptz<(p->>'startedAt')::timestamptz or (p->>'completedAt')::timestamptz>clock_timestamp()
 then raise exception 'MATURITY_READ_CLOCK_INVALID';end if;
 if policy->>'state'='unknown' then state:='unknown';reason:=policy->>'reason';
 else
  boundary:=((p->>'businessDate')::date+(policy->>'horizonDays')::int+2)::timestamp at time zone (p->>'timeZone');
  state:='provisional';reason:='attribution_window_open';
  if clock_timestamp()>=boundary then
   reason:='post_window_reconciliation_required';
   if complete and p->'complete'='true'::jsonb and report_ok and (p->>'startedAt')::timestamptz>=boundary then state:='final';reason:=null;end if;
  end if;
 end if;
 result:=jsonb_build_object('version','eo05c-maturity-v1','operationId',op,'revision',revision+1,'state',state,'reason',reason,
 'notBefore',case when boundary is null then null else to_char(boundary at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
 'businessDate',p->>'businessDate','timeZone',p->>'timeZone','policyFingerprint',policy->>'fingerprint',
 'configurationBatchId',cfg.id::text,'sources',p->'sources','reportBatchIds',p->'reportBatchIds','reportOperationId',p->'reportOperationId',
 'startedAt',p->>'startedAt','completedAt',p->>'completedAt','reportVerified',report_ok);
 result:=result||jsonb_build_object('digest',evidence.source_hash(result));
 if anchor.manifest->'reportRetention'->>'version'='report-source-3y-v1' then
  until_time:=(anchor.manifest->'reportRetention'->>'until')::timestamptz;
  perform analytics.hold_report_source_batch(o,cfg.id,until_time);
 end if;
 select manifest into m from evidence.source_batches where id=cfg.id;
 m:=jsonb_set(m,'{maturityDecisions}',entries||jsonb_build_object(op::text,result));
 if octet_length(m::text)>1048576 or octet_length((anchor.manifest||jsonb_build_object('maturityHead',result))::text)>1048576
 or d<=clock_timestamp() then raise exception 'MATURITY_MANIFEST_LIMIT_OR_DEADLINE';end if;
 update evidence.source_batches set manifest=m where id=cfg.id;
 update evidence.source_batches set manifest=manifest||jsonb_build_object('maturityHead',result) where id=anchor.id;
 return result;
end $fn$;

create function evidence.read_maturity_decision(o jsonb,a uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype; cfg evidence.source_batches%rowtype; newest evidence.source_batches%rowtype; head jsonb; ref jsonb;
 report_batch text; report_proof jsonb; report_ok boolean:=false; view_state jsonb;
begin
 perform evidence.assert_source_owner(o);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('eo05c:'||o::text,0));
 select * into strict b from evidence.source_batches where authority=o and attempt_id=a and batch_ordinal=0;
 head:=b.manifest->'maturityHead';if head is null then return null;end if;
 if b.storage_state<>'committed' or b.retain_until<=clock_timestamp() or b.manifest->'privacyRedacted'='true'::jsonb then raise exception 'MATURITY_SOURCE_UNAVAILABLE';end if;
 select * into strict cfg from evidence.source_batches where authority=o and id=(head->>'configurationBatchId')::bigint;
 perform analytics.assert_dataset_source(o,jsonb_build_object('batch_id',cfg.id::text,'commit_id',cfg.commit_id::text,'request_digest',cfg.request_digest,
 'page_id',cfg.manifest->'maturityConfiguration'->>'pageId','payload_hash',cfg.manifest->'maturityConfiguration'->>'payloadHash'));
 for ref in select value from jsonb_array_elements(head->'sources') loop
  perform analytics.assert_dataset_source(o,ref);
  if exists(select 1 from evidence.source_batches x where x.authority=o and x.id=(ref->>'batch_id')::bigint and x.manifest->'privacyRedacted'='true'::jsonb)
  then raise exception 'MATURITY_SOURCE_UNAVAILABLE';end if;
 end loop;
 select * into newest from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and primary_source=o->>'provider' and authority=o and storage_state='committed' and manifest ? 'maturityConfiguration'
 order by (manifest->'maturityConfiguration'->>'observedAt') COLLATE "C" desc,id desc limit 1;
 if newest.id is null or newest.retain_until<=clock_timestamp() or newest.manifest->'privacyRedacted'='true'::jsonb then raise exception 'MATURITY_CONFIGURATION_UNAVAILABLE';end if;
 perform analytics.assert_dataset_source(o,jsonb_build_object('batch_id',newest.id::text,'commit_id',newest.commit_id::text,'request_digest',newest.request_digest,
 'page_id',newest.manifest->'maturityConfiguration'->>'pageId','payload_hash',newest.manifest->'maturityConfiguration'->>'payloadHash'));
 if newest.manifest->'maturityConfiguration'->>'fingerprint' is distinct from head->>'policyFingerprint' then
  view_state:=head||jsonb_build_object('state',case when newest.manifest->'maturityConfiguration'->'policy'->>'state'='unknown' then 'unknown' else 'provisional' end,
   'reason','configuration_changed','inspectionOnly',true,'storedDigest',head->>'digest');
  return view_state||jsonb_build_object('digest',evidence.source_hash(view_state-'digest'));
 end if;
 if head->>'state'='final' then
  for report_batch in select value from jsonb_array_elements_text(head->'reportBatchIds') loop
   report_proof:=analytics.inspect_dataset_storage(o,report_batch::bigint,(head->>'reportOperationId')::uuid);
   if report_proof->>'status'='stored' then report_ok:=true;end if;
   report_proof:=analytics.inspect_dataset_empty_retention(o,report_batch::bigint,(head->>'reportOperationId')::uuid);
   if report_proof->>'status'='retained_empty' then report_ok:=true;end if;
  end loop;
  if not report_ok then
   view_state:=head||jsonb_build_object('state','provisional','reason','report_receipt_unavailable','inspectionOnly',true,'storedDigest',head->>'digest');
   return view_state||jsonb_build_object('digest',evidence.source_hash(view_state-'digest'));
  end if;
 end if;
 return head;
end $fn$;

create index source_batches_maturity_configuration_lookup on evidence.source_batches(workspace_id,installation_id,installation_generation,primary_source,((manifest->'maturityConfiguration'->>'observedAt') COLLATE "C") desc,id desc) where manifest ? 'maturityConfiguration';
revoke all on function evidence.maturity_policy(jsonb),evidence.register_maturity_configuration(jsonb,uuid,jsonb,timestamptz),
evidence.commit_maturity_decision(jsonb,jsonb,timestamptz),evidence.read_maturity_decision(jsonb,uuid)
from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
