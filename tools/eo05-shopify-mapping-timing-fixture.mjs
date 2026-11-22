import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {sourcePayloadHash} from "../app/lib/database/source-evidence-store.server.js";
import {verifyShopifyProductCandidate,shopifyProductVerificationEvidence} from "../app/lib/shopify/product-identity-verification.server.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";
import {verifiedMappingFixture} from "../tests/fixtures/verified-mapping-fixture.js";
import {createSyntheticReportMapping} from "../tests/fixtures/refresh-shopify-mapping-probe.js";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";
import {registerReviewedGoogleReportProduct} from "../app/lib/database/google-report-product-registration.server.js";

export async function seedShopifyMappingTimingFixture(client,{owner,cipher,window}) {
  assert.equal(client.connectionParameters.host,"127.0.0.1");
  assert.equal(Number(client.connectionParameters.port),54322);
  assert.ok(["google_ads","klaviyo","meta"].includes(owner.provider));
  const google=owner.provider==="google_ads";
  const meta=owner.provider==="meta";
  const fixture=verifiedMappingFixture(owner.provider,{owner,cipher,...owner.provider==="klaviyo"?{context:{metric_id:"m3"}}:{}});
  const ruleKey=`${fixture.rule.ruleKey}-${owner.provider}`;
  const node=(type,id)=>({id:`gid://shopify/${type}/${id}`,legacyResourceId:id});
  const product=node("Product","123");
  const verified=await verifyShopifyProductCandidate({
    shop:{authority:"shopify_admin_verified",shopId:owner.shopId,myshopifyDomain:owner.shopDomain},
    installation:{authority:"shopify_installation_verified",status:"active",workspaceId:owner.workspaceId,installGeneration:Number(owner.generation)},
    productId:"123",variantId:"456",admin:{async graphql(){return Response.json({data:{
      shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},product,productVariant:{...node("ProductVariant","456"),product},
    }});}},
  });
  assert.equal(verified.state,"candidate_verified_in_shop");
  fixture.check.shopifyVerification=shopifyProductVerificationEvidence(verified);
  const {mapping}=fixture.snapshot();
  const identity=JSON.parse(mapping.identityKey);
  const policy=sourceStoreFixture().input.policy;
  const emptyBatch=()=>({sourceState:"complete",policy,pages:[],references:[],rules:[],mappings:[],orders:[],lines:[],journeys:[],claims:[],links:[]});
  const commit=async(attempt,body)=>(await client.query("select evidence.commit_source_batch($1::jsonb,$2::uuid,0,$3::jsonb) result",
    [owner,attempt,body])).rows[0].result;
  // This is a prepared synthetic catalog/link snapshot. Store actual encrypted
  // evidence; the measured lookup and all Dataset guards still read real SQL.
  const origin=await commit(randomUUID(),emptyBatch());
  const completedAt=new Date().toISOString();
  const [readKey,readContext]=google?["googleRead",{merchantId:identity.context.merchant_id}]
    : meta?["metaRead",{target:{catalogId:identity.context.catalog_id}}]:["klaviyoRead",{sourceContext:{metricId:"m3"}}];
  await client.query("update evidence.source_batches set manifest=manifest||jsonb_build_object($1::text,$2::jsonb) where id=$3",
    [readKey,{...readContext,completedAt},origin.batchId]);
  const attempt=randomUUID(),body=emptyBatch();
  body.rules.push({key:"r",ruleKey,version:"1",kind:"product_identity",context:identity.context,
    parserVersion:fixture.rule.parserVersion,state:"reviewed",basis:fixture.rule.basis,applicability:fixture.rule.applicability});
  body.mappings.push({key:"m",rule:"r",identity,revision:"2",nativeId:identity.nativeId,context:identity.context,
    productId:verified.candidate.product_id,variantId:verified.candidate.variant_id,state:"verified",verifiedAt:completedAt,applicability:{state:"synthetic_fixture"}});
  for(const [ordinal,entry] of fixture.entries.entries()){
    const key=`p${ordinal}`;
    const row=entry.role==="review_basis"?{...entry.row,ruleKey}:entry.row;
    body.pages.push(cipher.seal({owner,attemptId:attempt,ordinal:0,page:{key,family:entry.family,ordinal,origin:owner.provider,
      captureLayer:entry.role==="native_product_observation"?"native_response_projection":"collector_projection",numericFidelity:"decoded_only",
      fieldCoverage:["records"],schemaVersion:entry.schema,sanitizerVersion:"synthetic-v1"},payload:{records:[row]}}));
    body.references.push({key,page:key,locatorKind:"row",locator:"/records/0",nativeType:entry.role,nativeId:null,state:"present",hash:sourcePayloadHash(row)});
    body.links.push({reference:key,targetType:entry.target,target:entry.target==="mapping"?"m":"r",role:entry.role});
  }
  const receipt=await commit(attempt,body);
  assert.ok(receipt.manifest.ids["mapping:m"]);
  await client.query("update evidence.source_batches set manifest=manifest||jsonb_build_object('kind','mapping_verification_v1','sourceBatchId',$2::text) where id=$1",[receipt.batchId,origin.batchId]);

  let reads=0,lookupMs=0;
  const mappingDatabase={async query(sql,args){
    assert.match(sql,/^select identity\.lookup_verified_mapping\(/);
    const started=performance.now();reads++;
    await client.query("savepoint timing_mapping_lookup");
    try{
      const result=await client.query(sql,args);
      await client.query("release savepoint timing_mapping_lookup");
      return result;
    }catch(error){
      await client.query("rollback to savepoint timing_mapping_lookup");
      await client.query("release savepoint timing_mapping_lookup");
      throw error;
    }finally{lookupMs+=performance.now()-started;}
  }};
  const googleLinks=google?[{state:"reviewed_synthetic_report_link",owner,nativeId:identity.nativeId,window,
    reportKey:{merchant_id:"99",feed_label:"US",content_language:"en"},merchantContext:identity.context}]:[];
  const metaLinks=meta?[{state:"reviewed_synthetic_report_link",owner,nativeId:identity.nativeId,window,catalogContext:identity.context}]:[];
  const bind=createSyntheticReportMapping({googleLinks,metaLinks,mappingDatabase});
  const bindSyntheticMappings=async input=>{
    try{await bind(input);}catch(error){
      const code=/^(?:MAPPING|SOURCE|DATASET)_[A-Z_]+$/.test(error.message)?error.message:"ASSERTION_FAILED";
      console.error("EO05_SHOPIFY_MAPPING_TIMING_REJECTED",owner.provider,code);
      throw error;
    }
  };
  const mappingId=receipt.manifest.ids["mapping:m"];
  async function seedGoogleDailyReportLinks({batches,deadlineAt}) {
    assert.equal(google,true);
    const source=await readStoredDatasetSources({database:client,cipher,owner,batches,
      limits:{maxRows:2000,maxPages:100,maxBytes:16777216,deadlineAt}});
    const pages=source.datasets.find(dataset=>dataset.dataset==="product_performance").pages;
    for(const [role,family] of [["performance","pmax_product_daily"],["sold","pmax_cart_data_product_sales_daily"]]) {
      const page=pages.find(item=>item.family===family);
      const receipt=await registerReviewedGoogleReportProduct({source,database:client,cipher,deadlineAt,
        target:{role,pageId:page.ref.page_id,identity,replacesMappingId:null},
        reviewAuthority:({claim,proposalHash,expiresAt})=>{
          assert.deepEqual(claim.identity,identity);
          assert.equal(claim.productId,verified.candidate.product_id);
          return {status:"approved",decisionId:randomUUID(),proposalHash,validUntil:expiresAt};
        }});
      assert.equal(receipt.mappingId,mappingId);
    }
    assert.equal((await client.query("select count(*)::int as total from identity.google_report_product_links where mapping_id=$1 and decision_id is not null and source_page_id is not null",[mappingId])).rows[0].total,2);
  }
  return {bindSyntheticMappings,seedGoogleDailyReportLinks,mappingId,
    productId:verified.candidate.product_id,nativeId:identity.nativeId,summary:()=>({reads,lookupMs})};
}
