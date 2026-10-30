// Synthetic transports exercise the real fenced PD reader, never a fake DTO.
import {createRefreshPdSourceReader} from "../../app/lib/refresh/pd-source-reader.server.js";
import {recordMetadata} from "./pd-record-metadata.js";
const credential="33333333-3333-4333-8333-333333333333";
export async function pdSourceObservation(scope,job,window) {
  const claim={workspaceId:scope.workspaceId,installGeneration:String(scope.installGeneration),provider:scope.provider,
    accountId:scope.accountId,id:job.id,fence:job.fence};
  const account={id:scope.accountId,kind:scope.provider==="klaviyo"?"account":"advertiser",status:"active",reporting_eligible:true,currency:"USD",timezone:"Europe/Istanbul"};
  const row={installation_id:scope.installationId,workspace_id:scope.workspaceId,install_generation:String(scope.installGeneration),installation_status:"active",
    shop_id:scope.shopId,shop_domain:scope.shopDomain,connection_id:scope.connectionId,credential_id:credential,
    connection_version:scope.connectionVersion,lifecycle_status:"connected",reporting_selection_epoch:scope.reportingSelectionEpoch,
    reporting_account_id:scope.provider==="klaviyo"?null:scope.accountId,accounts:[account],
    granted_scopes:scope.provider==="meta"?["ads_read"]:scope.provider==="google_ads"?["https://www.googleapis.com/auth/adwords"]
      :["accounts:read","campaigns:read","flows:read","events:read","metrics:read"]};
  const authority=async()=>({...claim,connectionId:scope.connectionId,connectionVersion:scope.connectionVersion,
    installationVerified:true,connected:true,setupComplete:true,allowedWindow:true});
  const config={claim,window,entitlementReceipt:{observedAt:"2026-10-30T00:00:00Z"},
    verified:{installationAuthority:{authority:"shopify_installation_verified",status:"active",workspaceId:scope.workspaceId,installGeneration:scope.installGeneration},
      identity:{session:{authority:"shopify_id_token_verified",shopDomain:scope.shopDomain},
        shop:{authority:"shopify_admin_verified",shopId:scope.shopId,myshopifyDomain:scope.shopDomain}}},
    database:{query:async()=>({rows:[structuredClone(row)]})},
    tokenVault:{loadProviderTokenSet:async()=>({access_token:"synthetic-access",refresh_token:"synthetic-refresh",expires_at:"2026-10-31T00:00:00Z",scopes:row.granted_scopes})},
    workStore:{loadBoundAuthority:authority,loadQuotaContext:async()=>({provider:scope.provider,accountId:scope.accountId,
      clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:scope.connectionVersion,organizationId:null,
      apiVersion:scope.provider==="meta"?"v26.0":scope.provider==="google_ads"?"v25":"2026-10-15"})},
    quotaStore:{resolveRoute:async v=>v.routeKey,reserve:async v=>({...v,status:"reserved",dispatchBeforeMs:1000,dispatchBudgetMs:1000}),settle:async()=>true,recordFeedback:async()=>true,stop:async()=>true},
    limits:{maxElapsedMs:10000,maxRows:100,maxBytes:300000},now:()=>0,readNow:()=>new Date("2026-10-30T00:00:00Z"),
    environment:{META_APP_SECRET:"synthetic-secret",GOOGLE_ADS_OAUTH_CLIENT_ID:"synthetic-client",GOOGLE_ADS_OAUTH_CLIENT_SECRET:"synthetic-secret",
      GOOGLE_ADS_OAUTH_REDIRECT_URI:"https://embedded.adstable.app/auth/google-ads/callback",KLAVIYO_CLIENT_ID:"synthetic-client",KLAVIYO_CLIENT_SECRET:"synthetic-secret",
      KLAVIYO_OAUTH_REDIRECT_URI:"https://embedded.adstable.app/auth/klaviyo/callback"},
    ...(scope.provider==="google_ads"?{queryFamily:"search_ad_channel_daily"}:{}),
    ...(scope.provider==="meta"?{nativeMetadata:true}:{}),
    fetchFn:async address=>{
      if(new URL(address).hostname==="oauth2.googleapis.com")return Response.json({access_token:"synthetic-access",token_type:"Bearer",expires_in:3600});
      if(scope.provider==="meta")return Response.json({data:[{account_id:scope.accountId.slice(4),campaign_id:"10",campaign_name:"Root",adset_id:"20",adset_name:"Parent",ad_id:"30",ad_name:"Leaf",
        date_start:window.from,date_stop:window.to,account_currency:"USD",attribution_setting:"7d_click,1d_view",impressions:"0",spend:"0",
        ...(new URL(address).searchParams.has("breakdowns")?{product_id:"native-product"}:{})}]});
      if(scope.provider==="google_ads")return Response.json({results:[{customer:{id:scope.accountId},campaign:{id:"10",advertisingChannelType:"SEARCH"},
        adGroup:{id:"20"},adGroupAd:{ad:{id:"30"}},segments:{date:window.from},metrics:{clicks:"0"}}]});
      return Response.json(new URL(address).pathname==="/api/metrics"?{data:["Placed Order","Added to Cart","Checkout Started"].map((name,i)=>({type:"metric",id:`m${i}`,attributes:{name,integration:{name:"Shopify"}}}))}
        :{data:{attributes:{results:[]}}});
    }};
  let observation=await createRefreshPdSourceReader(config).readEvidence();
  if(scope.provider==="meta") {
    config.recordBridge={metadata:recordMetadata(observation.source_context,observation.native_metadata.entries.map(e=>({scope:e.scope,source_execution:{metadata_references:e.metadata_references}})))};
    observation=await createRefreshPdSourceReader(config).readEvidence();
  }
  return {observation,config,row,authority};
}
