begin;

set local role adstable_owner;

revoke all on schema app, shopify, integrations, analytics, operations, privacy, billing
  from public, anon, authenticated, service_role;
grant usage on schema app, shopify, integrations, analytics, operations, privacy, billing
  to adstable_runtime;

reset role;

commit;
