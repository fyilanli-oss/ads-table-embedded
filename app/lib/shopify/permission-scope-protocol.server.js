// Read-only native protocol only. No OAuth grant, app-review, database or quota authority.
export const SHOPIFY_PERMISSION_SCOPES_QUERY = `#graphql
  query AdsTablePermissionScopes {
    shop { id myshopifyDomain }
    currentAppInstallation { id accessScopes { handle } }
  }
`;

export class ShopifyPermissionScopeProtocolError extends Error {
  constructor(code){super(`SHOPIFY_SCOPE_${code}`);this.name="ShopifyPermissionScopeProtocolError";}
}
const fail=code=>{throw new ShopifyPermissionScopeProtocolError(code);};
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);

export function shopifyPermissionScopeFamily(raw) {
  if(typeof raw!=="string"||raw.length>65536)return null;
  try {
    const body=JSON.parse(raw);
    if(!object(body)||JSON.stringify(body)!==raw||body.query!==SHOPIFY_PERMISSION_SCOPES_QUERY)return null;
    const keys=Object.keys(body).sort().join(",");
    if(keys!=="query"&&(keys!=="query,variables"||!object(body.variables)||Object.keys(body.variables).length!==0))return null;
    return "permission_scopes";
  } catch {return null;}
}

export function parseShopifyPermissionScopePage({shop,body}={}) {
  if(!object(shop)||typeof shop.id!=="string"||!/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(shop.id)
    ||typeof shop.myshopifyDomain!=="string"||!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop.myshopifyDomain))fail("SHOP_MISMATCH");
  if(!object(body)||(Object.hasOwn(body,"errors")&&(!Array.isArray(body.errors)||body.errors.length>0))||!object(body.data))fail("RESPONSE_INVALID");
  if(body.data.shop?.id!==shop?.id||body.data.shop?.myshopifyDomain!==shop?.myshopifyDomain)fail("SHOP_MISMATCH");
  const app=body.data.currentAppInstallation;
  if(!object(app)||typeof app.id!=="string"||!/^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]{0,19}$/.test(app.id)
    ||BigInt(app.id.split("/").at(-1))>18446744073709551615n||!Array.isArray(app.accessScopes)||app.accessScopes.length>100)fail("RESPONSE_INVALID");
  const scopes=app.accessScopes.map(s=>object(s)?s.handle:null);
  if(scopes.some(s=>typeof s!=="string"||s.length>200||!/^[a-z][a-z0-9_]*$/.test(s))||new Set(scopes).size!==scopes.length)fail("RESPONSE_INVALID");
  return Object.freeze({appInstallationId:app.id,scopes:Object.freeze(scopes)});
}
