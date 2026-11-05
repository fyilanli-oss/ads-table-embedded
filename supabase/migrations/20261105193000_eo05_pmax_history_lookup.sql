begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Existing encrypted shelves only. The requested report day is NOT the
-- historical validity of a current listing-tree observation.
create index source_batches_google_product_day on evidence.source_batches
 (workspace_id,installation_id,installation_generation,
 (manifest->'googleDatasetRead'->'window'->>'from'),id)
 where primary_source='google_ads' and manifest->'googleDatasetRead'->>'dataset'='product_performance';

create function evidence.find_google_pmax_source_batches(o jsonb,p_day date,p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 if o->>'provider' is distinct from 'google_ads' or p_day is null or not isfinite(p_day)
 or p_limit is null or p_limit not between 1 and 11 then raise exception 'PMAX_HISTORY_INPUT_INVALID';end if;
 perform evidence.assert_source_owner(o);
 return coalesce((select jsonb_agg(jsonb_build_object('batchId',b.id::text,'attemptId',b.attempt_id::text,
  'ordinal',b.batch_ordinal,'recordedAt',b.recorded_at,'retainUntil',b.retain_until) order by b.id)
 from (select x.* from evidence.source_batches x where x.workspace_id=(o->>'workspaceId')::uuid
 and x.installation_id=(o->>'installationId')::bigint and x.installation_generation=(o->>'generation')::bigint
 and x.shop_id=o->>'shopId' and x.primary_source='google_ads' and x.authority=o
 and x.manifest->'googleDatasetRead'->>'dataset'='product_performance'
 and x.manifest->'googleDatasetRead'->'window'->>'from'=p_day::text
 and x.manifest->'googleDatasetRead'->'window'->>'to'=p_day::text
 order by x.id limit p_limit) b),'[]'::jsonb);
end $fn$;
revoke all on function evidence.find_google_pmax_source_batches(jsonb,date,integer)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
-- No grant to the live source role and no activation, schedule or new table.
reset role;
commit;
