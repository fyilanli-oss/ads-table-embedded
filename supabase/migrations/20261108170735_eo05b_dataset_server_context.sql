begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- The narrow server transport must not SELECT operational tables directly.
-- Return only the original admitted snapshot for this exact current owner/day.
create function evidence.read_dataset_source_context(o jsonb,j text,f bigint,d1 date,d2 date)
returns table(source jsonb,snapshot_hash text,from_date text,to_date text)
language plpgsql security definer set search_path='' as $fn$
begin
 perform evidence.assert_source_owner(o);
 if coalesce(o->>'provider','') not in ('google_ads','meta','klaviyo') or j is null or length(j) not between 1 and 128
 or f is null or f<1 or d1 is null or d2 is distinct from d1 then raise exception 'DATASET_CONTEXT_INVALID';end if;
 return query select b.source,evidence.source_hash(b.source),b.from_date::text,b.to_date::text
 from operations.refresh_work_bindings b
 where b.workspace_id=(o->>'workspaceId')::uuid and b.install_generation=(o->>'generation')::bigint
 and b.provider=o->>'provider' and b.account_id=o->>'accountId' and b.job_id=j and b.fence=f and b.from_date=d1 and b.to_date=d2
 and b.source->>'connectionId'=o->>'connectionId' and b.source->>'connectionVersion'=o->>'connectionVersion';
end $fn$;
revoke all on function evidence.read_dataset_source_context(jsonb,text,bigint,date,date)
from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- One fixed private plan can start once across processes. Its original source
-- manifest is the existing bounded receipt ledger, not a sixth Dataset table.
-- A lost acknowledgement or later failure never resets this durable marker.
create function evidence.begin_dataset_storage_operation(o jsonb,a uuid,op uuid,h text,d timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype; entry jsonb; entries jsonb; m jsonb;
begin
 perform evidence.assert_source_owner(o);
 if coalesce(o->>'provider','') not in ('google_ads','meta','klaviyo') or a is null or op is null or h is null or h !~ '^[a-f0-9]{64}$' or d is null or not isfinite(d)
 or d<=clock_timestamp() or d>clock_timestamp()+interval '120 seconds' then raise exception 'DATASET_OPERATION_INVALID';end if;
 select * into b from evidence.source_batches where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
 and installation_generation=(o->>'generation')::bigint and authority=o and attempt_id=a and batch_ordinal=0 for update;
 if not found or b.storage_state<>'committed' or b.retain_until<=statement_timestamp() then raise exception 'DATASET_OPERATION_SOURCE_UNAVAILABLE';end if;
 entries:=coalesce(b.manifest->'datasetServerOperations','{}'::jsonb);
 if entries ? op::text then raise exception 'DATASET_OPERATION_ALREADY_STARTED';end if;
 if jsonb_typeof(entries)<>'object' or (select count(*) from jsonb_object_keys(entries))>=32 then raise exception 'DATASET_OPERATION_CAPACITY';end if;
 entry:=jsonb_build_object('status','accepted','operationId',op,'digest',h);
 m:=jsonb_set(b.manifest,'{datasetServerOperations}',entries||jsonb_build_object(op::text,entry));
 if octet_length(m::text)>1048576 then raise exception 'DATASET_OPERATION_CAPACITY';end if;
 if d<=clock_timestamp() then raise exception 'DATASET_OPERATION_DEADLINE';end if;
 update evidence.source_batches set manifest=m where id=b.id;
 return entry;
end $fn$;
revoke all on function evidence.begin_dataset_storage_operation(jsonb,uuid,uuid,text,timestamptz)
from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
