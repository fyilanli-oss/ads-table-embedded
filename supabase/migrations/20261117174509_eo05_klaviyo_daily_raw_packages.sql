-- Individual raw product packages remain partial until a verified day handoff.
create or replace function evidence.commit_klaviyo_dataset_source(o jsonb,p_attempt uuid,p_ordinal integer,p jsonb,r jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare w uuid:=(o->>'workspaceId')::uuid; iid bigint:=(o->>'installationId')::bigint; g bigint:=(o->>'generation')::bigint;
 ctx jsonb; prior evidence.source_batches%rowtype; receipt jsonb; input_hash text; k text; allowed text[]; binding operations.refresh_work_bindings%rowtype; eligibility jsonb; day_start_ms bigint; eligible_ms bigint;
 multipart boolean; package_count integer; event_pages integer; event_records integer;
begin
 multipart:=coalesce(r ? 'packageCount',false);
 if multipart then
  if jsonb_typeof(r->'packageCount') is distinct from 'number'
   or coalesce(r->>'packageCount','') !~ '^([2-9]|1[0-9]|20)$'
   or r->>'dataset' is distinct from 'product_performance'
   or p->>'sourceState' is distinct from 'partial'
   or octet_length(p::text)>1048576 then raise exception 'KLAVIYO_DATASET_PACKAGE_INVALID';end if;
  package_count:=(r->>'packageCount')::integer;
 else package_count:=1;
 end if;
 if o->>'provider' is distinct from 'klaviyo' or p_ordinal is null or p_ordinal<0 or p_ordinal>=package_count
 or jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>(case when multipart then 11 else 10 end)
 or not r ?& array['jobId','fence','window','observedAt','operationId','quotaContext','completedAt','deadlineAt','dataset','coverage']
 or coalesce(r->>'dataset','') not in ('configuration','account_performance','product_performance')
 or coalesce(p->>'sourceState','') not in ('complete','partial') or p_attempt is null
 or (r->>'operationId')::uuid is null then raise exception 'KLAVIYO_DATASET_BINDING_INVALID';end if;
 foreach k in array array['orders','lines','journeys','claims','rules','mappings','links'] loop
  if jsonb_array_length(p->k) is distinct from 0 then raise exception 'KLAVIYO_DATASET_FAMILY_INVALID';end if;
 end loop;
 allowed:=case r->>'dataset' when 'configuration' then array['klaviyo_account','klaviyo_metrics']
 when 'account_performance' then array['klaviyo_account','klaviyo_metrics','klaviyo_campaign_report','klaviyo_flow_report']
 else array['klaviyo_account','klaviyo_metrics','klaviyo_ordered_product_events'] end;
 if jsonb_typeof(p->'pages') is distinct from 'array' or jsonb_array_length(p->'pages') not between (case when multipart and p_ordinal>0 then 1 else 2 end) and 100
 or exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'origin' is distinct from 'klaviyo'
  or not (x->>'family'=any(allowed)) or x->>'captureLayer' is distinct from 'native_response_projection'
  or x->>'schemaVersion' is distinct from 'klaviyo-raw-datasets-v1'
  or x->>'sanitizerVersion' is distinct from 'klaviyo-native-fields-v1'
  or x->>'numericFidelity' is distinct from 'lossless_token') then raise exception 'KLAVIYO_DATASET_FAMILY_INVALID';end if;
 if (not multipart or p_ordinal=0) and exists(select 1 from unnest(array['klaviyo_account','klaviyo_metrics']) f where not exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'family'=f))
 then raise exception 'KLAVIYO_DATASET_INCOMPLETE';end if;
 allowed:=case r->>'dataset' when 'configuration' then array['accounts','metrics']
 when 'account_performance' then array['campaign:Placed Order','flow:Placed Order','campaign:Added to Cart','flow:Added to Cart','campaign:Checkout Started','flow:Checkout Started']
 else array['ordered_product_events'] end;
 if jsonb_typeof(r->'coverage') is distinct from 'array' or jsonb_array_length(r->'coverage')<>cardinality(allowed)
 or exists(select 1 from unnest(allowed) f where (select count(*) from jsonb_array_elements(r->'coverage') x where x->>'family'=f)<>1)
 or exists(select 1 from jsonb_array_elements(r->'coverage') x where jsonb_typeof(x) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(x))<>5 or not x ?& array['family','metricId','state','pageCount','recordCount']
  or coalesce(x->>'state','') not in ('present','account_configuration_missing')
  or coalesce(x->>'pageCount','')!~ '^[0-9]{1,4}$' or coalesce(x->>'recordCount','')!~ '^[0-9]{1,4}$'
  or (x->>'pageCount')::integer>100 or (x->>'recordCount')::integer>1000
  or (x->>'state'='present' and ((x->>'pageCount')::integer<1 or (r->>'dataset'<>'configuration' and (coalesce(x->>'metricId','')!~ '^[A-Za-z0-9_-]+$' or length(x->>'metricId')>256))))
  or (x->>'state'='account_configuration_missing' and (x->'metricId'<>'null'::jsonb or x->>'pageCount'<>'0' or x->>'recordCount'<>'0')))
 or (not multipart and (p->>'sourceState'='complete') is distinct from (not exists(select 1 from jsonb_array_elements(r->'coverage') x where x->>'state'<>'present')))
 or (multipart and r->'coverage'->0->>'state' is distinct from 'present')
 or (r->>'dataset'='configuration' and p->>'sourceState'<>'complete')
 then raise exception 'KLAVIYO_DATASET_COVERAGE_INVALID';end if;
 if not multipart and exists(select 1 from jsonb_array_elements(r->'coverage') x where x->>'state'='present'
  and not exists(select 1 from jsonb_array_elements(p->'pages') y where y->>'family'=case
   when x->>'family'='accounts' then 'klaviyo_account' when x->>'family'='metrics' then 'klaviyo_metrics'
   when x->>'family'='ordered_product_events' then 'klaviyo_ordered_product_events'
   when x->>'family' like 'campaign:%' then 'klaviyo_campaign_report' else 'klaviyo_flow_report' end))
 then raise exception 'KLAVIYO_DATASET_INCOMPLETE';end if;
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 perform 1 from operations.refresh_quota_contexts where workspace_id=w and install_generation=g and provider='klaviyo' for share;
 perform 1 from billing.workspace_subscriptions where workspace_id=w and installation_id=iid and install_generation=g for share;
 perform 1 from billing.workspace_entitlements where workspace_id=w and install_generation=g for share;
 ctx:=operations.load_refresh_quota_context(w,g,'klaviyo',o->>'accountId',r->>'jobId',(r->>'fence')::bigint,
  (r->'window'->>'from')::date,(r->'window'->>'to')::date,'klaviyo',(r->>'observedAt')::timestamptz);
 if ctx is null or ctx is distinct from r->'quotaContext'
 or (r->>'completedAt')::timestamptz<(r->>'observedAt')::timestamptz
 or (r->>'completedAt')::timestamptz>clock_timestamp()
 or (r->>'deadlineAt')::timestamptz<=clock_timestamp()
 or (r->>'deadlineAt')::timestamptz>clock_timestamp()+interval '10 minutes'
 or r->>'completedAt' is null or r->>'deadlineAt' is null
 then raise exception 'KLAVIYO_DATASET_READ_NOT_CURRENT';end if;
 select * into binding from operations.refresh_work_bindings b where b.workspace_id=w and b.install_generation=g and b.provider='klaviyo'
  and b.account_id=o->>'accountId' and b.job_id=r->>'jobId' and b.fence=(r->>'fence')::bigint
  and b.from_date=(r->'window'->>'from')::date and b.to_date=(r->'window'->>'to')::date;
 if not found or binding.from_date<>binding.to_date then raise exception 'KLAVIYO_RAW_ELIGIBILITY_REQUIRED';end if;
 eligible_ms:=(binding.source->>'eligibleFromMs')::bigint;
 day_start_ms:=floor(extract(epoch from (binding.from_date::timestamp at time zone (binding.source->>'timezone')))*1000)::bigint;
 if binding.from_date<(to_timestamp(eligible_ms::double precision/1000) at time zone (binding.source->>'timezone'))::date
  or (day_start_ms<eligible_ms and binding.partition_id is distinct from 'klaviyo-raw-capture:'||(r->>'operationId')::uuid::text)
 then raise exception 'KLAVIYO_RAW_ELIGIBILITY_REQUIRED';end if;
 eligibility:=jsonb_build_object('kind','klaviyo_raw_native_business_day_v1','businessDate',binding.from_date::text,
  'timezone',binding.source->>'timezone','eligibleFromMs',eligible_ms,'nativeDayStartMs',day_start_ms,
  'includesPreConnectionHours',day_start_ms<eligible_ms,'authorizesReportingDataset',false);
 perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||p_attempt::text||p_ordinal::text,0));
 input_hash:=evidence.source_hash(p);
 select * into prior from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and attempt_id=p_attempt and batch_ordinal=p_ordinal;
 if found then
  if prior.authority is distinct from o or prior.manifest->>'klaviyoDatasetInputDigest' is distinct from input_hash
   or prior.manifest->'klaviyoDatasetRead' is distinct from r then raise exception 'KLAVIYO_DATASET_OPERATION_CONFLICT';end if;
  return evidence.read_source_receipt(o,p_attempt,p_ordinal);
 end if;
 if multipart then
  select count(*) into event_pages from jsonb_array_elements(p->'pages') x where x->>'family'='klaviyo_ordered_product_events';
  select count(*) into event_records from jsonb_array_elements(p->'references') ref
   join jsonb_array_elements(p->'pages') x on x->>'key'=ref->>'page'
   where x->>'family'='klaviyo_ordered_product_events';
  if p_ordinal>0 then
   select * into prior from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g
    and attempt_id=p_attempt and batch_ordinal=p_ordinal-1 and authority=o and storage_state='committed'
    and handoff_state='pending' and source_state='partial' and retain_until>clock_timestamp();
   if not found or prior.manifest->'klaviyoDatasetRead' is distinct from r or prior.manifest->'klaviyoPackageCoverage' is null
    then raise exception 'KLAVIYO_DATASET_PACKAGE_PREDECESSOR_INVALID';end if;
   event_pages:=event_pages+(prior.manifest->'klaviyoPackageCoverage'->>'pages')::integer;
   event_records:=event_records+(prior.manifest->'klaviyoPackageCoverage'->>'events')::integer;
  end if;
  if event_pages>(r->'coverage'->0->>'pageCount')::integer or event_records>(r->'coverage'->0->>'recordCount')::integer
   or (p_ordinal=package_count-1 and (event_pages<>(r->'coverage'->0->>'pageCount')::integer
    or event_records<>(r->'coverage'->0->>'recordCount')::integer))
   then raise exception 'KLAVIYO_DATASET_PACKAGE_COUNTS_INVALID';end if;
 end if;
 receipt:=evidence.commit_source_batch(o,p_attempt,p_ordinal,p);
 update evidence.source_batches set manifest=manifest||jsonb_build_object('klaviyoDatasetRead',r,'klaviyoDatasetInputDigest',input_hash,'klaviyoRawEligibility',eligibility)
 || case when multipart then jsonb_build_object('klaviyoPackageCoverage',jsonb_build_object('pages',event_pages,'events',event_records)) else '{}'::jsonb end
 where id=(receipt->>'batchId')::bigint and workspace_id=w and installation_id=iid and installation_generation=g;
 if (r->>'deadlineAt')::timestamptz<=clock_timestamp() then raise exception 'KLAVIYO_DATASET_READ_EXPIRED';end if;
 return evidence.read_source_receipt(o,p_attempt,p_ordinal);
end $fn$;
