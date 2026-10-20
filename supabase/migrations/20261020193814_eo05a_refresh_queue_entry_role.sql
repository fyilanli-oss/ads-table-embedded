begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Prepared authority only: no login, password, membership, schedule or live activation.
create role adstable_refresh_queue_runner nologin noinherit nosuperuser
  nocreatedb nocreaterole noreplication nobypassrls;
set local role adstable_owner;
grant usage on schema operations to adstable_refresh_queue_runner;
grant execute on function operations.check_refresh_queue_on_tick(uuid),operations.review_refresh_interrupted_work()
  to adstable_refresh_queue_runner;
reset role;
commit;
