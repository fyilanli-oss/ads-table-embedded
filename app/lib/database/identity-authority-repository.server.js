// Function-only nonsecret snapshot; no token, caller primary key or table fallback.
export function createIdentityAuthorityRepository(database){
  if(typeof database?.query!=="function")throw Error("IDENTITY_AUTHORITY_INPUT_INVALID");
  return Object.freeze({async load({workspaceId,installGeneration,provider,shopId,shopDomain}){
    try{
      const result=await database.query("select * from integrations.load_provider_identity_authority($1::uuid,$2::bigint,$3::text,$4::text,$5::text)",
        [workspaceId,installGeneration,provider,shopId,shopDomain]);
      if(!Array.isArray(result?.rows)||result.rows.length>1)throw Error();
      if(!result.rows.length)return null;
      const row=result.rows[0],id=v=>typeof v==="string"&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
      if(!id(row.installation_id)||(provider==="klaviyo"?row.reporting_selection_epoch!==null:!id(row.reporting_selection_epoch)))throw Error();
      return {installationId:row.installation_id,workspaceId:row.workspace_id,installGeneration:Number(row.install_generation),
        installationStatus:row.installation_status,shopId:row.shop_id,shopDomain:row.shop_domain,
        connectionId:row.connection_id,credentialId:row.credential_id,connectionVersion:Number(row.connection_version),status:row.lifecycle_status,
        grantedScopes:row.granted_scopes,accounts:typeof row.accounts==="string"?JSON.parse(row.accounts):row.accounts,
        reportingAccountId:row.reporting_account_id??null,selectionEpoch:row.reporting_selection_epoch};
    }catch{throw Error("IDENTITY_AUTHORITY_READ_FAILED");}
  }});
}
