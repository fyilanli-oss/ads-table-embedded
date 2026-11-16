-- Prepared for authorized rollback-only replay. No runtime grants.
create table analytics.klaviyo_hourly_event_facts (
  workspace_id uuid not null,
  installation_id bigint not null,
  generation bigint not null,
  account_id text not null,
  connection_id uuid not null,
  connection_version bigint not null,
  metric_id text not null,
  hour_start timestamptz not null,
  observed_at timestamptz not null,
  event_count int not null check (event_count between 0 and 20000),
  source_batch_id bigint not null references evidence.source_batches(id) on delete cascade,
  primary key(workspace_id,installation_id,generation,account_id,connection_id,connection_version,metric_id,hour_start)
);
create index klaviyo_hourly_event_facts_source_idx on analytics.klaviyo_hourly_event_facts(source_batch_id);
create table analytics.klaviyo_hourly_event_receipts (
  source_batch_id bigint primary key references evidence.source_batches(id) on delete cascade,
  receipt jsonb not null
);
create table analytics.klaviyo_hourly_product_sales (
  source_batch_id bigint not null references evidence.source_batches(id) on delete cascade,
  event_id text not null,
  hour_start timestamptz not null,
  ordinal integer not null,
  sale jsonb not null,
  primary key(source_batch_id,event_id),
  unique(source_batch_id,ordinal)
);
alter table analytics.klaviyo_hourly_event_facts enable row level security;
alter table analytics.klaviyo_hourly_event_facts force row level security;
alter table analytics.klaviyo_hourly_event_receipts enable row level security;
alter table analytics.klaviyo_hourly_event_receipts force row level security;
alter table analytics.klaviyo_hourly_product_sales enable row level security;
alter table analytics.klaviyo_hourly_product_sales force row level security;
create policy owner_only on analytics.klaviyo_hourly_event_facts to adstable_owner using(true) with check(true);
create policy owner_only on analytics.klaviyo_hourly_event_receipts to adstable_owner using(true) with check(true);
create policy owner_only on analytics.klaviyo_hourly_product_sales to adstable_owner using(true) with check(true);
revoke all on analytics.klaviyo_hourly_event_facts,analytics.klaviyo_hourly_event_receipts,analytics.klaviyo_hourly_product_sales
from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function analytics.commit_klaviyo_hourly_event_report(o jsonb, attempt uuid, digest text, counts jsonb, deadline timestamptz, sales jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype; s jsonb; observed timestamptz; start_at timestamptz;
  result jsonb; applied jsonb; product_digest text;
begin
  if o->>'provider' is distinct from 'klaviyo' or attempt is null
    or deadline is null or deadline<=clock_timestamp() or deadline>clock_timestamp()+interval '10 minutes'
    or coalesce(digest,'') !~ '^[a-f0-9]{64}$' or jsonb_typeof(counts) is distinct from 'array'
    or jsonb_typeof(sales) is distinct from 'array' or octet_length(sales::text)>8388608
    then raise exception 'KLAVIYO_HOURLY_REPORT_INVALID';
  end if;
  if jsonb_array_length(counts)<>2 or exists (
    select 1 from jsonb_array_elements(counts) as c(value)
    where jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]{1,5}$' or value::text::int>20000
  ) then raise exception 'KLAVIYO_HOURLY_REPORT_INVALID'; end if;
  perform 1 from operations.refresh_control where singleton for update;
  perform evidence.assert_source_owner(o);
  select * into b from evidence.source_batches
  where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
    and installation_generation=(o->>'generation')::bigint and attempt_id=attempt and batch_ordinal=0
    and authority=o and storage_state='committed' and source_state='complete' and retain_until>clock_timestamp()
  for update;
  if not found or b.manifest->'klaviyoHourlyManifest'->>'digest' is distinct from digest
    or (counts->>0)::int+(counts->>1)::int is distinct from (b.manifest->'klaviyoHourlyManifest'->>'rows')::int
    then raise exception 'KLAVIYO_HOURLY_REPORT_SOURCE_INVALID';
  end if;
  s := b.manifest->'klaviyoHourlyRead';
  observed := (b.manifest->>'klaviyoHourlyObservedAt')::timestamptz;
  start_at := (s->'timeframe'->>'start')::timestamptz;
  if observed is null or start_at is null
    or operations.refresh_claim_is_current(b.workspace_id,b.installation_generation,'klaviyo',
      o->>'accountId',s->>'jobId',(s->>'fence')::bigint) is distinct from true
    or not exists(select 1 from operations.refresh_work_bindings binding
      where binding.workspace_id=b.workspace_id and binding.install_generation=b.installation_generation
        and binding.provider='klaviyo' and binding.account_id=o->>'accountId'
        and binding.job_id=s->>'jobId' and binding.fence=(s->>'fence')::bigint
        and binding.deadline_at_ms>extract(epoch from clock_timestamp())*1000)
    then raise exception 'KLAVIYO_HOURLY_REPORT_CLAIM_INVALID';
  end if;
  if jsonb_array_length(sales) is distinct from (counts->>0)::int+(counts->>1)::int
    or exists(select 1 from jsonb_array_elements(sales) as data(item)
      where jsonb_typeof(item) is distinct from 'object'
        or item->>'metricId' is distinct from s->>'metricId'
        or coalesce(length(item->>'eventId'),0) not between 1 and 256
        or item->>'occurredAt' is null or (item->>'occurredAt')::timestamptz<start_at
        or (item->>'occurredAt')::timestamptz>=start_at+interval '2 hours')
    or (select count(*) from jsonb_array_elements(sales) as data(item)
      where (item->>'occurredAt')::timestamptz<start_at+interval '1 hour') is distinct from (counts->>0)::int
    then raise exception 'KLAVIYO_HOURLY_REPORT_PRODUCTS_INVALID';
  end if;
  product_digest := evidence.source_hash(sales);
  select receipt into result from analytics.klaviyo_hourly_event_receipts where source_batch_id=b.id;
  if found then
    if result->'counts' is distinct from counts or result->>'productDigest' is distinct from product_digest
      then raise exception 'KLAVIYO_HOURLY_REPORT_CONFLICT'; end if;
    return result;
  end if;
  insert into analytics.klaviyo_hourly_product_sales(source_batch_id,event_id,hour_start,ordinal,sale)
  select b.id,item->>'eventId',
    case when (item->>'occurredAt')::timestamptz<start_at+interval '1 hour' then start_at else start_at+interval '1 hour' end,
    ord::int,item
  from jsonb_array_elements(sales) with ordinality as data(item,ord);
  with written as (
    insert into analytics.klaviyo_hourly_event_facts as fact
      (workspace_id,installation_id,generation,account_id,connection_id,connection_version,metric_id,hour_start,observed_at,event_count,source_batch_id)
    select b.workspace_id,b.installation_id,b.installation_generation,o->>'accountId',(o->>'connectionId')::uuid,
      (o->>'connectionVersion')::bigint,s->>'metricId',start_at+part.n*interval '1 hour',observed,(counts->>part.n)::int,b.id
    from generate_series(0,1) part(n) order by part.n
    on conflict (workspace_id,installation_id,generation,account_id,connection_id,connection_version,metric_id,hour_start)
    do update set observed_at=excluded.observed_at,event_count=excluded.event_count,source_batch_id=excluded.source_batch_id
    where excluded.observed_at>fact.observed_at
    returning hour_start
  ) select coalesce(jsonb_agg(hour_start order by hour_start),'[]'::jsonb) into applied from written;
  result := jsonb_build_object('attemptId',attempt,'digest',digest,'counts',counts,'applied',applied,
    'productRows',jsonb_array_length(sales),'productDigest',product_digest);
  insert into analytics.klaviyo_hourly_event_receipts values (b.id,result);
  if deadline<=clock_timestamp() then raise exception 'KLAVIYO_HOURLY_REPORT_EXPIRED'; end if;
  return result;
end $fn$;

create function analytics.read_klaviyo_hourly_event_report(o jsonb, attempt uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare b evidence.source_batches%rowtype; result jsonb; start_at timestamptz;
begin
  perform evidence.assert_source_owner(o);
  select * into b from evidence.source_batches
  where workspace_id=(o->>'workspaceId')::uuid and installation_id=(o->>'installationId')::bigint
    and installation_generation=(o->>'generation')::bigint and attempt_id=attempt and batch_ordinal=0
    and authority=o and storage_state='committed' and source_state='complete';
  if not found then return null; end if;
  select receipt into result from analytics.klaviyo_hourly_event_receipts where source_batch_id=b.id;
  if not found then return null; end if;
  if (select evidence.source_hash(coalesce(jsonb_agg(sale order by ordinal),'[]'::jsonb))
    from analytics.klaviyo_hourly_product_sales where source_batch_id=b.id)
    is distinct from result->>'productDigest' then return null; end if;
  start_at := (b.manifest->'klaviyoHourlyRead'->'timeframe'->>'start')::timestamptz;
  if exists (
    select 1 from jsonb_array_elements_text(result->'applied') as wanted(hour_text)
    where not exists(select 1 from analytics.klaviyo_hourly_event_facts
      where source_batch_id=b.id and hour_start=wanted.hour_text::timestamptz
      and event_count=(result->'counts'->>(case when hour_start=start_at then 0 else 1 end))::int)
  ) then return null; end if;
  return result;
end $fn$;

-- The worker must reach its Dataset handoff even if the report was written
-- during request_intent. Recheck the physical receipt before releasing capacity.
create function analytics.finish_klaviyo_hourly_event_report(o jsonb, j text, f bigint, attempt uuid, verified jsonb)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare
  w uuid := (o->>'workspaceId')::uuid;
  g bigint := (o->>'generation')::bigint;
  a text := o->>'accountId';
  deadline_ms bigint;
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not found or o->>'provider' is distinct from 'klaviyo'
    or jsonb_typeof(verified) is distinct from 'object' then return false; end if;
  perform evidence.assert_source_owner(o);
  if operations.refresh_claim_is_current(w,g,'klaviyo',a,j,f) is not true then return false; end if;

  select binding.deadline_at_ms into deadline_ms
  from operations.refresh_work_bindings binding
  join operations.refresh_work_progress progress using (workspace_id,install_generation,provider,account_id,job_id,fence)
  join evidence.source_batches b on b.workspace_id=binding.workspace_id
    and b.installation_generation=binding.install_generation and b.authority=o
    and b.attempt_id=attempt and b.batch_ordinal=0
  cross join lateral (select b.manifest->'klaviyoHourlyRead' as scope) source
  where binding.workspace_id=w and binding.install_generation=g and binding.provider='klaviyo'
    and binding.account_id=a and binding.job_id=j and binding.fence=f
    and progress.stage='ready_for_dataset'
    and b.retain_until>clock_timestamp()
    and source.scope->>'jobId'=j and source.scope->>'fence'=f::text
    and binding.partition_id='klaviyo-hourly-source:'||(source.scope->'timeframe'->>'start')
      ||'/'||(source.scope->'timeframe'->>'end');
  if not found or deadline_ms<=extract(epoch from clock_timestamp())*1000
    or analytics.read_klaviyo_hourly_event_report(o,attempt) is distinct from verified
    or deadline_ms<=extract(epoch from clock_timestamp())*1000 then return false; end if;

  return operations.finish_refresh_work_before_stops(w,g,'klaviyo',a,j,f,'completed');
end $fn$;

revoke all on function analytics.commit_klaviyo_hourly_event_report(jsonb,uuid,text,jsonb,timestamptz,jsonb),
 analytics.read_klaviyo_hourly_event_report(jsonb,uuid),
 analytics.finish_klaviyo_hourly_event_report(jsonb,text,bigint,uuid,jsonb)
from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner;
