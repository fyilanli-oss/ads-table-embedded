begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

-- One current receipt, not an ever-growing event journal. Activation is owner-only and unset.
create table operations.refresh_tick_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  generation uuid,
  sequence bigint not null default 0 check (sequence between 0 and 9007199254740991),
  last_minute bigint check (last_minute >= 0),
  last_checked_at_ms bigint check (last_checked_at_ms >= 0),
  queue_revision bigint check (queue_revision between 0 and 9007199254740991),
  check (not enabled or generation is not null),
  check ((last_minute is null) = (last_checked_at_ms is null)),
  check ((last_minute is null) = (queue_revision is null))
);
alter table operations.refresh_tick_control enable row level security;
alter table operations.refresh_tick_control force row level security;
create policy refresh_tick_control_owner on operations.refresh_tick_control to adstable_owner using (true) with check (true);
revoke all on operations.refresh_tick_control from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
insert into operations.refresh_tick_control(singleton) values(true);

create function operations.check_refresh_queue_on_tick(p_generation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  q operations.refresh_queue_control%rowtype;
  t operations.refresh_tick_control%rowtype;
  now_ms bigint; minute_id bigint; checked_ms bigint; result jsonb;
begin
  -- Same order as native inventory/preflight. No lock is held across HTTP work.
  perform 1 from operations.refresh_control where singleton for update;
  select * into strict q from operations.refresh_queue_control where singleton for update;
  select * into strict t from operations.refresh_tick_control where singleton for update;
  if not t.enabled or t.generation is null then return jsonb_build_object('status','not_configured'); end if;
  if p_generation is null or p_generation<>t.generation then return jsonb_build_object('status','not_current_generation'); end if;
  now_ms := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  minute_id := now_ms/60000;
  if now_ms<0 or t.last_minute>minute_id or t.last_checked_at_ms>now_ms or q.last_success_at_ms>now_ms then
    return jsonb_build_object('status','clock_invalid');
  end if;
  if t.last_minute=minute_id then return jsonb_build_object('status','duplicate'); end if;
  if t.sequence=9007199254740991 then raise exception 'REFRESH_TICK_SEQUENCE_EXHAUSTED'; end if;
  -- Native complete bounded inventory and the receipt commit together, or neither commits.
  result := operations.check_refresh_queue_from_authority(q.revision);
  if result->>'committed' is distinct from 'true' then raise exception 'REFRESH_TICK_QUEUE_CONFLICT'; end if;
  checked_ms := (result->>'lastSuccessAtMs')::bigint;
  if checked_ms is null or checked_ms<now_ms then raise exception 'REFRESH_TICK_CLOCK_INVALID'; end if;
  update operations.refresh_tick_control set sequence=sequence+1,last_minute=minute_id,
    last_checked_at_ms=checked_ms,queue_revision=q.revision+1 where singleton;
  return jsonb_build_object('status','checked','generation',t.generation::text,'sequence',t.sequence+1,
    'queueRevision',q.revision+1,'checkedAtMs',checked_ms);
end
$fn$;
revoke all on function operations.check_refresh_queue_on_tick(uuid) from public,anon,authenticated,service_role,adstable_runtime;
grant execute on function operations.check_refresh_queue_on_tick(uuid) to adstable_refresh_coordinator;
reset role;
commit;
