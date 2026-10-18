begin;

set local role adstable_owner;

drop index if exists shopify.installations_shop_domain_idx;
drop index if exists shopify.installation_domain_history_installation_idx;

reset role;

commit;
