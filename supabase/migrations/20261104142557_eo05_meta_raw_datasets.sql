begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Prepared only: existing encrypted shelves, one envelope per fixed dataset.
-- No jobs, quota settings, schedules, native data or role grants are provisioned.
create function evidence.commit_meta_dataset_source(o jsonb,p_attempt uuid,p_ordinal integer,p jsonb,r jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare w uuid:=(o->>'workspaceId')::uuid; iid bigint:=(o->>'installationId')::bigint; g bigint:=(o->>'generation')::bigint;
 ctx jsonb; prior evidence.source_batches%rowtype; receipt jsonb; input_hash text; k text; allowed text[];
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
 perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||p_attempt::text||p_ordinal::text,0));
 input_hash:=evidence.source_hash(p);
 select * into prior from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and attempt_id=p_attempt and batch_ordinal=0;
 if found then
  if prior.authority is distinct from o or prior.manifest->>'metaDatasetInputDigest' is distinct from input_hash
   or prior.manifest->'metaDatasetRead' is distinct from r then raise exception 'META_DATASET_OPERATION_CONFLICT';end if;
  return evidence.read_source_receipt(o,p_attempt,0);
 end if;
 receipt:=evidence.commit_source_batch(o,p_attempt,0,p);
 update evidence.source_batches set manifest=manifest||jsonb_build_object('metaDatasetRead',r,'metaDatasetInputDigest',input_hash)
 where id=(receipt->>'batchId')::bigint and workspace_id=w and installation_id=iid and installation_generation=g;
 if (r->>'deadlineAt')::timestamptz<=clock_timestamp() or (r->>'permissionExpiresAt')::timestamptz<=clock_timestamp() then raise exception 'META_DATASET_READ_EXPIRED';end if;
 return evidence.read_source_receipt(o,p_attempt,0);
end $fn$;
revoke all on function evidence.commit_meta_dataset_source(jsonb,uuid,integer,jsonb,jsonb)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
