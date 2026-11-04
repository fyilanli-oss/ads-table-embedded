begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Raw-source only. The generic refresh/Google/Klaviyo admission functions are
-- deliberately not replaced. No rows, logins, keys, policies or schedules added.
create function operations.commit_meta_raw_preflight_with_deadline(p_revision bigint,p_queue_revision bigint,p_state jsonb,p_source jsonb,p_window jsonb,p_operation uuid,p_deadline bigint)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare q operations.refresh_queue_accounts%rowtype; cfg operations.refresh_queue_control%rowtype;
 base_source jsonb; actual jsonb; selected jsonb; additions integer; start_day date; now_ms bigint; expected_job text;
begin
 perform 1 from operations.refresh_control where singleton for update;
 select * into strict cfg from operations.refresh_queue_control where singleton for update;
 now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if p_revision is null or p_queue_revision is null or p_operation is null or p_deadline is null
  or p_deadline<=now_ms or p_deadline>now_ms+120000
  or p_revision<>(select revision from operations.refresh_control where singleton) or p_queue_revision<>cfg.revision
  or cfg.max_snapshot_age_ms is null or cfg.last_success_at_ms is null or cfg.last_success_at_ms>now_ms
  or now_ms-cfg.last_success_at_ms>cfg.max_snapshot_age_ms
  or p_source->>'provider' is distinct from 'meta' then return false;end if;
 select * into q from operations.refresh_queue_accounts where workspace_id=(p_source->>'workspaceId')::uuid
  and install_generation=(p_source->>'installGeneration')::bigint and provider='meta' and account_id=p_source->>'accountId';
 if not found or q.state<>'pending' or not q.connection_open then return false;end if;
 base_source:=operations.refresh_preflight_source(q.workspace_id,q.install_generation,'meta',q.account_id);
 actual:=base_source||jsonb_build_object('scheduledHour',q.first_due_hour_ms,'queuedAt',q.first_queued_at_ms);
 if base_source is null or actual is distinct from p_source or base_source->>'connectionId' is distinct from q.connection_id
  or (base_source->>'connectionVersion')::bigint is distinct from q.connection_version
  or (base_source->>'eligibleFromMs')::bigint is distinct from q.eligible_from_ms then return false;end if;
 if jsonb_typeof(p_window) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_window))<>2
  or coalesce(p_window->>'from','')!~ '^\d{4}-\d{2}-\d{2}$' or p_window->>'from' is distinct from p_window->>'to' then return false;end if;
 start_day:=(p_window->>'from')::date;
 -- Native daily aggregates cannot be clipped to a consent timestamp. Only the
 -- connection's native calendar day or a later eligible day may be captured.
 if start_day<(to_timestamp(q.eligible_from_ms::double precision/1000) at time zone (base_source->>'timezone'))::date
  or start_day>(clock_timestamp() at time zone (base_source->>'timezone'))::date then return false;end if;
 select count(*) into additions from jsonb_array_elements(p_state->'claims') c(value)
  where not exists(select 1 from operations.refresh_runs r where r.fence=(c.value->>'fence')::bigint and r.status='running');
 if additions<>1 then return false;end if;
 select value into selected from jsonb_array_elements(p_state->'claims') c(value)
  where not exists(select 1 from operations.refresh_runs r where r.fence=(c.value->>'fence')::bigint and r.status='running');
 expected_job:=encode(sha256(convert_to('["meta_raw_capture_v1","'||p_operation::text||'","'||q.workspace_id::text||'","'||q.install_generation::text||'","'||q.account_id||'"]','UTF8')),'hex');
 if selected->>'workspaceId' is distinct from q.workspace_id::text or selected->>'installGeneration' is distinct from q.install_generation::text
  or selected->>'provider' is distinct from 'meta' or selected->>'accountId' is distinct from q.account_id
  or selected->>'id' is distinct from expected_job
  or coalesce((selected->'cost'->>'requests')::bigint,0)<2
  or exists(select 1 from operations.refresh_runs r where r.workspace_id=q.workspace_id and r.install_generation=q.install_generation
   and r.provider='meta' and r.account_id=q.account_id and r.job_id=expected_job) then return false;end if;
 if not operations.commit_refresh_admissions(p_revision,p_state) then return false;end if;
 insert into operations.refresh_work_bindings(workspace_id,install_generation,provider,account_id,job_id,fence,source,from_date,to_date,partition_id,deadline_at_ms)
 values(q.workspace_id,q.install_generation,'meta',q.account_id,expected_job,(selected->>'fence')::bigint,base_source,start_day,start_day,'meta-raw-capture:'||p_operation::text,p_deadline);
 if p_deadline<=floor(extract(epoch from clock_timestamp())*1000)::bigint then raise exception 'META_RAW_ADMISSION_DEADLINE_EXPIRED';end if;
 return true;
end $fn$;
revoke all on function operations.commit_meta_raw_preflight_with_deadline(bigint,bigint,jsonb,jsonb,jsonb,uuid,bigint)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.commit_meta_raw_preflight_with_deadline(bigint,bigint,jsonb,jsonb,jsonb,uuid,bigint) to adstable_refresh_coordinator;

create or replace function evidence.commit_meta_dataset_source(o jsonb,p_attempt uuid,p_ordinal integer,p jsonb,r jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare w uuid:=(o->>'workspaceId')::uuid; iid bigint:=(o->>'installationId')::bigint; g bigint:=(o->>'generation')::bigint;
 ctx jsonb; prior evidence.source_batches%rowtype; receipt jsonb; input_hash text; k text; allowed text[]; binding operations.refresh_work_bindings%rowtype; eligibility jsonb; day_start_ms bigint; eligible_ms bigint;
begin
 if o->>'provider' is distinct from 'meta' or p_ordinal is distinct from 0
 or jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>10
 or not r ?& array['jobId','fence','window','observedAt','operationId','quotaContext','completedAt','deadlineAt','dataset','permissionExpiresAt']
 or coalesce(r->>'dataset','') not in ('account_performance','product_performance')
 or p->>'sourceState' is distinct from 'complete' or p_attempt is null
 or (r->>'operationId')::uuid is null then raise exception 'META_DATASET_BINDING_INVALID';end if;
 foreach k in array array['orders','lines','journeys','claims','rules','mappings','links'] loop
  if jsonb_array_length(p->k) is distinct from 0 then raise exception 'META_DATASET_FAMILY_INVALID';end if;
 end loop;
 allowed:=case r->>'dataset' when 'account_performance' then array['meta_permission_check','ad_channel_daily_insights']
 else array['meta_permission_check','ad_product_breakdown_daily_insights'] end;
 if jsonb_typeof(p->'pages') is distinct from 'array' or jsonb_array_length(p->'pages') not between 1 and 100
 or exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'origin' is distinct from 'meta'
  or not (x->>'family'=any(allowed)) or x->>'captureLayer' is distinct from 'native_response_projection'
  or x->>'schemaVersion' is distinct from 'meta-raw-datasets-v1'
  or x->>'sanitizerVersion' is distinct from 'meta-query-fields-v1'
  or x->>'numericFidelity' is distinct from 'lossless_token') then raise exception 'META_DATASET_FAMILY_INVALID';end if;
 if exists(select 1 from unnest(allowed) f where not exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'family'=f))
 then raise exception 'META_DATASET_INCOMPLETE';end if;
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 perform 1 from operations.refresh_quota_contexts where workspace_id=w and install_generation=g and provider='meta' for share;
 perform 1 from billing.workspace_subscriptions where workspace_id=w and installation_id=iid and install_generation=g for share;
 perform 1 from billing.workspace_entitlements where workspace_id=w and install_generation=g for share;
 ctx:=operations.load_refresh_quota_context(w,g,'meta',o->>'accountId',r->>'jobId',(r->>'fence')::bigint,
  (r->'window'->>'from')::date,(r->'window'->>'to')::date,'meta',(r->>'observedAt')::timestamptz);
 if ctx is null or ctx is distinct from r->'quotaContext'
 or (r->>'completedAt')::timestamptz<(r->>'observedAt')::timestamptz
 or (r->>'completedAt')::timestamptz>clock_timestamp()
 or (r->>'deadlineAt')::timestamptz<=clock_timestamp()
 or (r->>'deadlineAt')::timestamptz>clock_timestamp()+interval '10 minutes'
 or r->>'completedAt' is null or r->>'deadlineAt' is null or r->>'permissionExpiresAt' is null
 or not isfinite((r->>'permissionExpiresAt')::timestamptz)
 or (r->>'permissionExpiresAt')::timestamptz<=clock_timestamp()
 then raise exception 'META_DATASET_READ_NOT_CURRENT';end if;
 select * into binding from operations.refresh_work_bindings b where b.workspace_id=w and b.install_generation=g and b.provider='meta'
  and b.account_id=o->>'accountId' and b.job_id=r->>'jobId' and b.fence=(r->>'fence')::bigint
  and b.from_date=(r->'window'->>'from')::date and b.to_date=(r->'window'->>'to')::date;
 if not found or binding.from_date<>binding.to_date then raise exception 'META_RAW_ELIGIBILITY_REQUIRED';end if;
 eligible_ms:=(binding.source->>'eligibleFromMs')::bigint;
 day_start_ms:=floor(extract(epoch from (binding.from_date::timestamp at time zone (binding.source->>'timezone')))*1000)::bigint;
 if binding.from_date<(to_timestamp(eligible_ms::double precision/1000) at time zone (binding.source->>'timezone'))::date
  or (day_start_ms<eligible_ms and binding.partition_id is distinct from 'meta-raw-capture:'||(r->>'operationId')::uuid::text)
 then raise exception 'META_RAW_ELIGIBILITY_REQUIRED';end if;
 eligibility:=jsonb_build_object('kind','meta_raw_native_business_day_v1','businessDate',binding.from_date::text,
  'timezone',binding.source->>'timezone','eligibleFromMs',eligible_ms,'nativeDayStartMs',day_start_ms,
  'includesPreConnectionHours',day_start_ms<eligible_ms,'authorizesReportingDataset',false);
 perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||p_attempt::text||p_ordinal::text,0));
 input_hash:=evidence.source_hash(p);
 select * into prior from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and attempt_id=p_attempt and batch_ordinal=0;
 if found then
  if prior.authority is distinct from o or prior.manifest->>'metaDatasetInputDigest' is distinct from input_hash
   or prior.manifest->'metaDatasetRead' is distinct from r then raise exception 'META_DATASET_OPERATION_CONFLICT';end if;
  return evidence.read_source_receipt(o,p_attempt,0);
 end if;
 receipt:=evidence.commit_source_batch(o,p_attempt,0,p);
 update evidence.source_batches set manifest=manifest||jsonb_build_object('metaDatasetRead',r,'metaDatasetInputDigest',input_hash,'metaRawEligibility',eligibility)
 where id=(receipt->>'batchId')::bigint and workspace_id=w and installation_id=iid and installation_generation=g;
 if (r->>'deadlineAt')::timestamptz<=clock_timestamp() or (r->>'permissionExpiresAt')::timestamptz<=clock_timestamp() then raise exception 'META_DATASET_READ_EXPIRED';end if;
 return evidence.read_source_receipt(o,p_attempt,0);
end $fn$;
revoke all on function evidence.commit_meta_dataset_source(jsonb,uuid,integer,jsonb,jsonb)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
