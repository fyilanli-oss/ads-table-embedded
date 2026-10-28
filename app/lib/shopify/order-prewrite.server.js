import {isShopifyOrderCollectionObservation} from "./order-collection.server.js";
import {shopifyPrewriteOwner} from "../providers/prewrite-owner.server.js";
import {createShopifyInstallationOwnerRepository} from "../database/shopify-installation-owner-repository.server.js";

export class ShopifyOrderPrewriteError extends Error {
  constructor(code){super(`SHOPIFY_ORDER_PREWRITE_${code}`);this.name="ShopifyOrderPrewriteError";}
}
const fail=code=>{throw new ShopifyOrderPrewriteError(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};

// Read-only structural review of completed, branded in-process observations. It does
// not load a prior database row, select a winner for a writer or verify native access.
export function reviewShopifyOrderPrewrite({expected,current,previous=null,...extra}={}) {
  if(Object.keys(extra).length)fail("INPUT_INVALID");
  let owner;try{owner=shopifyPrewriteOwner(expected);}catch{fail("INPUT_INVALID");}
  const keyFor=(orderId,lineId)=>[owner.workspaceId,owner.shopId,orderId,...lineId===undefined?[]:[lineId]];
  function index(collection){
    if(!isShopifyOrderCollectionObservation(collection))fail("OBSERVATION_REQUIRED");
    if(collection.scope.installation_id!==owner.installationId||collection.scope.workspace_id!==owner.workspaceId||collection.scope.installation_generation!==owner.installGeneration
      ||collection.shop.id!==owner.shopId||collection.shop.myshopifyDomain!==owner.shopDomain)fail("OWNER_MISMATCH");
    if(collection.salesPagesComplete!==true)fail("SALES_INCOMPLETE");
    const orders=new Map(),lineOwners=new Map();
    for(const order of collection.orders){
      const id=order.header.id;if(orders.has(id))fail("ORDER_DUPLICATE");
      const lines=new Map();
      for(const line of order.lineItems){
        if(lines.has(line.id))fail("LINE_DUPLICATE");
        if(lineOwners.has(line.id)&&lineOwners.get(line.id)!==id)fail("LINE_OWNER_CONFLICT");
        lineOwners.set(line.id,id);lines.set(line.id,line);
      }
      orders.set(id,{order,lines});
    }
    return {orders,lineOwners};
  }
  const next=index(current),prior=previous===null?{orders:new Map(),lineOwners:new Map()}:index(previous);
  if(previous&&previous.nativeScopeObservation.after.evidence.appInstallationId!==current.nativeScopeObservation.before.evidence.appInstallationId)fail("APP_INSTALLATION_CHANGED");
  const orders=[];
  for(const [id,{order,lines}] of next.orders){
    const old=prior.orders.get(id),updated=Date.parse(order.header.updatedAt),oldUpdated=old?Date.parse(old.order.header.updatedAt):null;
    if(old&&updated<oldUpdated)fail("STALE_VERSION");
    if(old&&updated===oldUpdated&&(!equal(order.header,old.order.header)||lines.size!==old.lines.size
      ||[...lines].some(([lineId,line])=>!equal(line,old.lines.get(lineId)))))fail("SAME_VERSION_CONFLICT");
    const rows=[];
    for(const [lineId,line] of lines){
      if(prior.lineOwners.has(lineId)&&prior.lineOwners.get(lineId)!==id)fail("LINE_OWNER_CONFLICT");
      const before=old?.lines.get(lineId);
      rows.push({key:keyFor(id,lineId),change:before?equal(before,line)?"unchanged":"changed":"new",observed:line});
    }
    orders.push({key:keyFor(id),change:old?updated===oldUpdated?"replay":"new_version":"new",
      observed:order.header,lines:rows,previousUpdatedAt:old?.order.header.updatedAt??null,
      previousLineKeysNotObserved:old?[...old.lines.keys()].filter(lineId=>!lines.has(lineId)).map(lineId=>keyFor(id,lineId)):[],
      journey:order.journey,journeyChange:old?equal(old.order.journey,order.journey)?"unchanged":"changed":"new"});
  }
  return freeze({status:"structurally_reviewed_open_gates",owner,orders,
    previousOrderKeysNotObserved:[...prior.orders.keys()].filter(id=>!next.orders.has(id)).map(id=>keyFor(id)),
    salesPagesComplete:current.salesPagesComplete,journeyPagesComplete:current.journeyPagesComplete,
    provenance:{currentScope:current.scope,previousScope:previous?.scope??null,
      currentRange:current.extractionRange,previousRange:previous?.extractionRange??null},
    installationIdentityChecked:true,authorityReobserved:false,
    missingRecordsProveDeletion:false,atomicSnapshotVerified:false,canonicalScopeReady:false,
    nativePermissionVerified:false,historicalCoverageVerified:false,providerClaimVerified:false,exactOverlapVerified:false,
    persistable:false,authorizesActivation:false,DatasetWritePerformed:false,
    remaining:["native_access_and_canonical_SQL_scope_review","provider_claim_reconciliation","existing_step14_review_before_new_tables_and_writers"]});
}

export async function reviewShopifyOrderPrewriteCurrent({expected,current,previous=null,database,signal,...extra}={}){
  if(Object.keys(extra).length||signal!==undefined&&!(signal instanceof AbortSignal))fail("INPUT_INVALID");
  const review=reviewShopifyOrderPrewrite({expected,current,previous}),owner=review.owner;
  if(signal?.aborted)fail("ABORTED");
  let actual;try{actual=await createShopifyInstallationOwnerRepository(database).load(owner);}catch{fail("AUTHORITY_READ_FAILED");}
  if(signal?.aborted)fail("ABORTED");
  if(actual?.installationId!==owner.installationId)fail("AUTHORITY_CHANGED");
  return freeze({...review,authorityReobserved:true,atomicWriteGuardVerified:false});
}
