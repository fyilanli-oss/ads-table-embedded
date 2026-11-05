begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Explicit prepared NOLOGIN role. Activation/password is a separate owner gate.
create role adstable_privacy_source_runner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 1 password null;
set local role adstable_owner;
grant usage on schema privacy to adstable_privacy_source_runner;
grant execute on function privacy.inspect_customer_source_work(uuid),privacy.reserve_customer_source_work(uuid,timestamptz),
 privacy.worker_customer_source_snapshot(uuid),privacy.complete_customer_source_work(uuid,text,jsonb),
 privacy.hold_customer_source_work(uuid,text) to adstable_privacy_source_runner;
reset role;
commit;
