begin;

set local role adstable_owner;

create or replace function privacy.process_deletion_queue(
  p_batch_size integer default 25
)
returns table (
  lock_acquired boolean,
  selected_count integer,
  completed_count integer,
  superseded_count integer,
  failed_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate record;
  execution_status text;
  v_selected integer := 0;
  v_completed integer := 0;
  v_superseded integer := 0;
  v_failed integer := 0;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 100 then
    raise exception 'INVALID_DELETION_QUEUE_BATCH_SIZE';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('privacy-deletion-queue-worker', 0)
  ) then
    return query select false, 0, 0, 0, 0;
    return;
  end if;

  for candidate in
    select run.id
      from privacy.deletion_runs as run
     where run.status = 'pending'
        or (
          run.status = 'failed'
          and run.attempt_count < 20
          and run.updated_at <= statement_timestamp() - pg_catalog.make_interval(
            secs => (
              300 * pg_catalog.power(
                2::numeric,
                least(greatest(run.attempt_count - 1, 0), 6)
              )
            )::double precision
          )
        )
     order by run.deadline_at asc, run.requested_at asc, run.id asc
     for update skip locked
     limit p_batch_size
  loop
    v_selected := v_selected + 1;
    begin
      select result.deletion_status
        into execution_status
        from privacy.execute_deletion_run(candidate.id) as result;

      if execution_status = 'completed' then
        v_completed := v_completed + 1;
      elsif execution_status = 'superseded' then
        v_superseded := v_superseded + 1;
      else
        raise exception 'UNEXPECTED_DELETION_EXECUTION_STATUS';
      end if;
    exception when others then
      update privacy.deletion_runs as run
         set status = 'failed',
             started_at = coalesce(run.started_at, statement_timestamp()),
             attempt_count = run.attempt_count + 1,
             last_error_code = 'DELETION_EXECUTION_SQLSTATE_' || sqlstate,
             updated_at = statement_timestamp()
       where run.id = candidate.id
         and run.status in ('pending', 'failed');
      v_failed := v_failed + 1;
    end;
  end loop;

  return query
    select true, v_selected, v_completed, v_superseded, v_failed;
end
$function$;

revoke all on function privacy.process_deletion_queue(integer)
  from public, anon, authenticated, service_role, adstable_runtime;
grant execute on function privacy.process_deletion_queue(integer)
  to postgres;

comment on function privacy.process_deletion_queue(integer) is
  'Durable generation-locked privacy queue consumer. One advisory-locked batch, bounded retries, no raw error text. PostgreSQL GREATEST/LEAST are unqualified conditional expressions.';

reset role;

commit;
