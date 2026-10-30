import {inspectShopifyIdentityPermissionScopes} from "../../app/lib/shopify/permission-scopes.server.js";
export function shopifyScopeProof(scope,scopes=["read_products"],at="2026-10-29T15:00:00.000Z") {
  return inspectShopifyIdentityPermissionScopes({now:()=>new Date(at),
    verified:{installationAuthority:{authority:"shopify_installation_verified",status:"active",workspaceId:scope.workspaceId,installGeneration:scope.installGeneration},
      identity:{session:{authority:"shopify_id_token_verified",shopDomain:scope.shopDomain},shop:{authority:"shopify_admin_verified",shopId:scope.shopId,myshopifyDomain:scope.shopDomain}},
      context:{admin:{graphql:async()=>({json:async()=>({data:{shop:{id:scope.shopId,myshopifyDomain:scope.shopDomain},currentAppInstallation:{id:"gid://shopify/AppInstallation/9",accessScopes:scopes.map(handle=>({handle}))}}})})}}},
    database:{query:async()=>({rows:[{workspace_id:scope.workspaceId,install_generation:scope.installGeneration,installation_status:"active"}]})}});
}
