import {sqlIdentityKey} from "../providers/prewrite-owner.server.js";

// Function-only active installation lookup. No provider token/account dependency.
export function createShopifyInstallationOwnerRepository(database){
  if(typeof database?.query!=="function")throw Error("SHOPIFY_INSTALLATION_OWNER_INPUT_INVALID");
  return Object.freeze({async load({workspaceId,installGeneration,shopId,shopDomain}){
    try{
      const result=await database.query("select * from shopify.load_active_installation_owner($1::uuid,$2::bigint,$3::text,$4::text)",
        [workspaceId,installGeneration,shopId,shopDomain]);
      if(!Array.isArray(result?.rows)||result.rows.length>1)throw Error();
      if(!result.rows.length)return null;
      const row=result.rows[0];
      if(!sqlIdentityKey(row.installation_id)||row.workspace_id!==workspaceId
        ||Number(row.install_generation)!==installGeneration||row.shop_id!==shopId||row.shop_domain!==shopDomain
        ||row.installation_status!=="active")throw Error();
      return Object.freeze({installationId:row.installation_id,workspaceId,installGeneration,shopId,shopDomain});
    }catch{throw Error("SHOPIFY_INSTALLATION_OWNER_READ_FAILED");}
  }});
}
