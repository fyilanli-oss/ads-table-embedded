begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

create policy provider_connections_owner_all
  on integrations.provider_connections
  for all
  to adstable_owner
  using (true)
  with check (true);

create policy provider_accounts_owner_all
  on integrations.provider_accounts
  for all
  to adstable_owner
  using (true)
  with check (true);

create policy reporting_account_bindings_owner_all
  on integrations.reporting_account_bindings
  for all
  to adstable_owner
  using (true)
  with check (true);

create index provider_accounts_connection_authority_fk_idx
  on integrations.provider_accounts (
    connection_id, workspace_id, install_generation, provider
  );

create index reporting_account_bindings_account_authority_fk_idx
  on integrations.reporting_account_bindings (
    account_id, connection_id, workspace_id, install_generation, provider
  );

reset role;

commit;
