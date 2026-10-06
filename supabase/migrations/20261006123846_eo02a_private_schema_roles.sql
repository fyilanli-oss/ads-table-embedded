begin;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'adstable_owner') then
    create role adstable_owner
      nologin
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'adstable_migrator') then
    create role adstable_migrator
      login
      password null
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'adstable_runtime') then
    create role adstable_runtime
      login
      password null
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;
end
$roles$;

alter role adstable_owner
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role adstable_migrator
  login password null noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role adstable_runtime
  login password null noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

grant adstable_owner to adstable_migrator with inherit false, set true;

create schema if not exists app authorization adstable_owner;
create schema if not exists shopify authorization adstable_owner;
create schema if not exists integrations authorization adstable_owner;
create schema if not exists analytics authorization adstable_owner;
create schema if not exists operations authorization adstable_owner;
create schema if not exists privacy authorization adstable_owner;
create schema if not exists billing authorization adstable_owner;

revoke create on schema public from public, anon, authenticated, service_role;

revoke all on schema app, shopify, integrations, analytics, operations, privacy, billing
  from public, anon, authenticated, service_role;
grant usage on schema app, shopify, integrations, analytics, operations, privacy, billing
  to adstable_runtime;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger on tables
  from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences
  from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions
  from public, anon, authenticated, service_role;

alter default privileges for role adstable_owner in schema app
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role adstable_owner in schema shopify
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role adstable_owner in schema integrations
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role adstable_owner in schema analytics
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role adstable_owner in schema operations
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role adstable_owner in schema privacy
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role adstable_owner in schema billing
  revoke all on tables from public, anon, authenticated, service_role;

alter default privileges for role adstable_owner
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role adstable_owner
  revoke usage, select, update on sequences from public, anon, authenticated, service_role;
alter default privileges for role adstable_owner
  revoke usage on types from public, anon, authenticated, service_role;

commit;
