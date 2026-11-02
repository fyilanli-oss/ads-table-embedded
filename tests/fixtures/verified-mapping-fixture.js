import {randomUUID} from "node:crypto";
import {sourceStoreFixture} from "./source-store-fixture.js";
import {sourcePayloadHash} from "../../app/lib/database/source-evidence-store.server.js";
export function verifiedMappingFixture(provider="google_ads", overrides={}){
 const {input}=sourceStoreFixture(overrides.cipher?{cipher:overrides.cipher}:{});const now=Date.now(),until=new Date(now+3600000).toISOString();
 const owner={...input.owner,provider,connectionId:randomUUID(),connectionVersion:"1",accountId:provider==="meta"?"act_101":provider==="klaviyo"?"account-a":"101",selectionEpoch:provider==="klaviyo"?null:"1",credentialId:randomUUID(),...overrides.owner};
 const baseContext=provider==="google_ads"?{merchant_id:"99",feed_label:"US",content_language:"en",data_source:"accounts/99/dataSources/7",legacy_local:false}:
 provider==="meta"?{catalog_id:"99",graph_version:"v26.0",identity_namespace:"catalog_product_id",product_feed_state:"observed",product_feed_id:"7"}:
 {metric_id:"metric1",integration:"Shopify",product_property:"ProductID",product_id_source_type:"string",variant:{state:"observed",sourceType:"string",value:"456"},legacy_variant:{state:"missing"}};
 const context={...baseContext,...overrides.context};
 const nativeId=provider==="google_ads"?"shopify_US_123_456":provider==="meta"?"900":"123";
 const rule={id:"2",ruleKey:"synthetic-rule",version:"1",kind:"product_identity",context,parserVersion:"product-mapping-v1",retainUntil:until,
  basis:{version:"product-source-rule-v1",provider,format:provider==="klaviyo"?"klaviyo_shopify_ordered_product":"shopify_market_product_variant",...(provider==="klaviyo"?{}:{market:"US"})},
  applicability:{owner,from:new Date(now-60000).toISOString(),until,maxObservationAgeMs:600000}};
 const proof={schemaVersion:"shopify-product-verification-v1",scope:{workspace_id:owner.workspaceId,installation_generation:Number(owner.generation),shop_id:owner.shopId,shop_domain:owner.shopDomain},request:{productId:"gid://shopify/Product/123",variantId:"gid://shopify/ProductVariant/456"},response:{shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},product:{state:"observed",id:"gid://shopify/Product/123",legacyResourceId:"123"},variant:{state:"observed",id:"gid://shopify/ProductVariant/456",legacyResourceId:"456",product:{id:"gid://shopify/Product/123",legacyResourceId:"123"}}},outcome:{state:"candidate_verified_in_shop",reason:"provider_source_rule_and_link_still_required"},providerMappingVerified:false};
 const native=provider==="google_ads"?{offerId:nativeId,feedLabel:"US",contentLanguage:"en",dataSource:context.data_source}:
 provider==="meta"?{id:nativeId,retailer_id:"shopify_US_123_456",product_feed:{id:context.product_feed_id}}:
 {id:"event1",attributes:{event_properties:{ProductID:"123","Variant ID":"456"}},relationships:{metric:{data:{type:"metric",id:"metric1"}}}};
 const check={...(provider==="google_ads"?{nativeProductId:nativeId,context}:provider==="meta"?{catalogProductId:nativeId,retailerId:native.retailer_id,context:{catalog_id:context.catalog_id,product_feed_id:context.product_feed_id}}:{eventId:"event1"}),shopifyVerification:proof};
 const projection={ruleKey:rule.ruleKey,version:rule.version,kind:rule.kind,context,parserVersion:rule.parserVersion,basis:rule.basis,applicability:rule.applicability};
 const entries=[{target:"mapping",role:provider==="klaviyo"?"native_product_observation":"native_product",family:provider==="google_ads"?"merchant_products":provider==="meta"?"meta_catalog_products":"klaviyo_ordered_product_events",schema:provider==="google_ads"?"google-identity-allowlist-v1":provider==="meta"?"meta-identity-allowlist-v1":"klaviyo-source-allowlist-v1",row:native},
 {target:"mapping",role:"candidate_check",family:(provider==="google_ads"?"google":provider)+"_candidate_checks",schema:(provider==="google_ads"?"google":provider)+"-candidate-check-v2",row:check},
 {target:"rule",role:"review_basis",family:"source_rule_review",schema:"source-rule-review-v1",row:projection}];
 if(provider==="klaviyo")entries.push({target:"mapping",role:"metric",family:"klaviyo_metrics",schema:"native-v1",row:{id:"metric1",attributes:{name:"Ordered Product",integration:{name:"Shopify"}}}});
 function snapshot(){return {owner,mapping:{id:"1",revision:"1",identityVersion:"1",identityKey:JSON.stringify({provider,accountId:owner.accountId,nativeId,context}),nativeId,context,state:"unresolved",productId:null,variantId:null,retainUntil:until},rule,sourceBatchId:"1",sourceCommitId:randomUUID(),sourceDigest:"b".repeat(64),completedAt:new Date(now-1000).toISOString(),snapshotHash:"a".repeat(64),
  references:entries.map((entry,i)=>({id:String(i+1),pageId:String(i+1),locator:"/records/0",nativeType:entry.role,nativeId:null,recordHash:sourcePayloadHash(entry.row),role:entry.role,target:entry.target,retainUntil:until})),
  pages:entries.map((entry,i)=>{const attemptId=input.attemptId;return {...input.cipher.seal({owner,attemptId,ordinal:0,page:{family:entry.family,ordinal:i,origin:provider,captureLayer:provider==="klaviyo"&&entry.role==="native_product_observation"?"native_response_projection":"collector_projection",numericFidelity:"decoded_only",fieldCoverage:["records"],schemaVersion:entry.schema,sanitizerVersion:"synthetic-v1"},payload:{records:[entry.row]}}),id:String(i+1),batchId:"1",attemptId,batchOrdinal:0,retainUntil:until};})};}
 return {owner,now,cipher:input.cipher,rule,proof,native,check,entries,snapshot,policy:{version:"synthetic-policy",until:new Date(now+60000).toISOString()},deadlineAt:new Date(now+60000).toISOString()};
}
