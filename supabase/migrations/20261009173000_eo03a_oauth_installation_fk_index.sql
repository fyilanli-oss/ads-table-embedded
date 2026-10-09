begin;

set local role adstable_owner;

create index oauth_transactions_installation_fk_idx
  on integrations.oauth_transactions (installation_id);

reset role;

commit;
