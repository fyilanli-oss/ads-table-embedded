begin;

set local role adstable_owner;

create index provider_authorization_handoffs_installation_fk_idx
  on integrations.provider_authorization_handoffs (installation_id);

reset role;

commit;
