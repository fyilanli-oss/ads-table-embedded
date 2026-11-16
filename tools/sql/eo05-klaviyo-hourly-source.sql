-- Prepared private source writer. Install only in an authorized migration or
-- rollback-only rehearsal. Runtime execution roles are deliberately excluded.
create function evidence.commit_klaviyo_hourly_source(
  o jsonb, p_attempt uuid, p jsonb, s jsonb, m jsonb, observed_at timestamptz,
  deadline_at timestamptz, quota_context jsonb
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  w uuid := (o->>'workspaceId')::uuid;
  iid bigint := (o->>'installationId')::bigint;
  g bigint := (o->>'generation')::bigint;
  f bigint := (s->>'fence')::bigint;
  a text := o->>'accountId';
  job text := s->>'jobId';
  first_hour timestamptz := (s->'timeframe'->>'start')::timestamptz;
  hour_end timestamptz := (s->'timeframe'->>'end')::timestamptz;
  b operations.refresh_work_bindings%rowtype;
  prior evidence.source_batches%rowtype;
  receipt jsonb;
  ctx jsonb;
  request_hash text;
  k text;
begin
  if p_attempt is null or o->>'provider' is distinct from 'klaviyo'
    or s->>'provider' is distinct from 'klaviyo'
    or s->>'version' is distinct from 'klaviyo-ordered-product-hourly-v1'
    or s->>'workspaceId' is distinct from w::text
    or s->>'installGeneration' is distinct from g::text
    or s->>'accountId' is distinct from a or s->'endExclusive' is distinct from 'true'::jsonb
    or coalesce(s->>'metricId','') !~ '^[A-Za-z0-9_-]{1,256}$'
    or first_hour is null or hour_end is null
    or not isfinite(first_hour) or not isfinite(hour_end)
    or hour_end-first_hour <> interval '2 hours'
    or observed_at is null or observed_at < hour_end or observed_at > clock_timestamp()
    or deadline_at is null or deadline_at <= clock_timestamp()
    or deadline_at > clock_timestamp()+interval '10 minutes'
    or m->>'version' is distinct from 'klaviyo-hourly-source-batch-v1'
    or m->>'attemptId' is distinct from p_attempt::text
    or coalesce(m->>'digest','') !~ '^[0-9a-f]{64}$'
    or p->>'sourceState' is distinct from 'complete'
    or jsonb_typeof(p->'pages') is distinct from 'array'
    or jsonb_typeof(m->'pages') is distinct from 'array'
    then raise exception 'KLAVIYO_HOURLY_SOURCE_INPUT_INVALID';
  end if;
  if jsonb_array_length(p->'pages') not between 1 and 100
    or jsonb_array_length(p->'pages') <> jsonb_array_length(m->'pages')
    or exists (
      select 1
      from jsonb_array_elements(p->'pages') with ordinality as ep(page,n)
      join jsonb_array_elements(m->'pages') with ordinality as mp(entry,n) using (n)
      where page->>'origin' is distinct from 'klaviyo'
        or page->>'family' is distinct from 'klaviyo_ordered_product_events'
        or page->>'schemaVersion' is distinct from 'klaviyo-ordered-product-hourly-v1'
        or page->>'captureLayer' is distinct from 'native_response_projection'
        or page->>'numericFidelity' is distinct from 'lossless_token'
        or page->>'sanitizerVersion' is distinct from 'klaviyo-native-fields-v1'
        or page->>'ordinal' is distinct from (n-1)::text
        or entry->>'ordinal' is distinct from (n-1)::text
        or page->>'payloadHash' is distinct from entry->>'payloadHash'
        or page->>'plainBytes' is distinct from entry->>'plainBytes'
    ) then raise exception 'KLAVIYO_HOURLY_SOURCE_PAGES_INVALID';
  end if;
  foreach k in array array['references','rules','mappings','orders','lines','journeys','claims','links'] loop
    if p->k is distinct from '[]'::jsonb then raise exception 'KLAVIYO_HOURLY_SOURCE_INPUT_INVALID'; end if;
  end loop;

  perform 1 from operations.refresh_control where singleton for update;
  perform evidence.assert_source_owner(o);
  perform 1 from operations.refresh_quota_contexts where workspace_id=w and install_generation=g and provider='klaviyo' for share;
  perform 1 from billing.workspace_subscriptions where workspace_id=w and installation_id=iid and install_generation=g for share;
  perform 1 from billing.workspace_entitlements where workspace_id=w and install_generation=g for share;
  select * into b from operations.refresh_work_bindings
  where workspace_id=w and install_generation=g and provider='klaviyo' and account_id=a and job_id=job and fence=f;
  if not found or operations.refresh_claim_is_current(w,g,'klaviyo',a,job,f) is distinct from true
    or b.partition_id is distinct from ('klaviyo-hourly-source:'||(s->'timeframe'->>'start')||'/'||(s->'timeframe'->>'end'))
    or b.source->>'timezone' is distinct from s->>'timeZone'
    or b.from_date is distinct from (first_hour at time zone (b.source->>'timezone'))::date
    or b.to_date is distinct from ((hour_end-interval '1 microsecond') at time zone (b.source->>'timezone'))::date
    or b.source->>'eligibleFromMs' is null or b.deadline_at_ms is null
    or extract(epoch from first_hour)*1000 < (b.source->>'eligibleFromMs')::bigint
    or clock_timestamp() >= to_timestamp(b.deadline_at_ms::double precision/1000)
    then raise exception 'KLAVIYO_HOURLY_SOURCE_CLAIM_INVALID';
  end if;
  ctx := operations.load_refresh_quota_context(w,g,'klaviyo',a,job,f,b.from_date,b.to_date,'klaviyo',observed_at);
  if ctx is null or ctx is distinct from quota_context then raise exception 'KLAVIYO_HOURLY_SOURCE_CLAIM_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||p_attempt::text||'0',0));
  request_hash := evidence.source_hash(jsonb_build_object('body',p,'scope',s,'manifest',m));
  select * into prior from evidence.source_batches where workspace_id=w and installation_id=iid
    and installation_generation=g and attempt_id=p_attempt and batch_ordinal=0;
  if found then
    if prior.authority is distinct from o or prior.manifest->>'klaviyoHourlyInputDigest' is distinct from request_hash
      then raise exception 'KLAVIYO_HOURLY_SOURCE_CONFLICT';
    end if;
  else
    receipt := evidence.commit_source_batch(o,p_attempt,0,p);
    update evidence.source_batches set manifest=manifest||jsonb_build_object(
      'klaviyoHourlyRead',s,'klaviyoHourlyManifest',m,'klaviyoHourlyInputDigest',request_hash
    ) where id=(receipt->>'batchId')::bigint and workspace_id=w and installation_id=iid and installation_generation=g;
  end if;
  if deadline_at<=clock_timestamp() then raise exception 'KLAVIYO_HOURLY_SOURCE_EXPIRED'; end if;
  return evidence.read_source_receipt(o,p_attempt,0);
end $fn$;

revoke all on function evidence.commit_klaviyo_hourly_source(jsonb,uuid,jsonb,jsonb,jsonb,timestamptz,timestamptz,jsonb)
from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
