-- Isolated test database only. Separate approval is required to execute.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '10s';

create role adstable_queue_observer nologin nosuperuser nocreatedb nocreaterole
  noinherit noreplication nobypassrls connection limit 1;
grant usage on schema operations to adstable_queue_observer;
grant execute on function operations.read_refresh_queue_witness() to adstable_queue_observer;
commit;
