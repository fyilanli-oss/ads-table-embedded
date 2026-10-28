export function createShopifyOrderQueueRepository(database){
  if(typeof database?.query!=="function")throw Error("SHOPIFY_ORDER_QUEUE_DATABASE_REQUIRED");
  async function one(sql,args){
    const result=await database.query(sql,args);
    if(!Array.isArray(result?.rows)||result.rows.length!==1)throw Error("SHOPIFY_ORDER_QUEUE_RESULT_INVALID");
    return typeof result.rows[0].result==="string"?JSON.parse(result.rows[0].result):result.rows[0].result;
  }
  const ownerArgs=o=>[o.installationId,o.workspaceId,o.installGeneration,o.shopId,o.shopDomain];
  return Object.freeze({
    readAdmission:owner=>one("select operations.read_shopify_order_queue_admission($1::bigint,$2::uuid,$3::bigint,$4::text,$5::text) as result",ownerArgs(owner)),
    enqueue:({proposal,revision,configurationEpoch,contexts,routes})=>one(`select operations.enqueue_shopify_order_range(
      $1::bigint,$2::uuid,$3::bigint,$4::text,$5::text,$6::text,$7::timestamptz,$8::timestamptz,
      $9::boolean,$10::integer,$11::bigint,$12::bigint,$13::jsonb,$14::jsonb) as result`,
      [...ownerArgs(proposal.owner),proposal.key,proposal.range.fromInclusive,proposal.range.toExclusive,
        proposal.includeOrderHistory,proposal.pageSize,revision,configurationEpoch,JSON.stringify(contexts),JSON.stringify(routes)]),
    read:proposal=>one("select operations.read_shopify_order_pending_range($1::bigint,$2::uuid,$3::bigint,$4::text,$5::text,$6::text) as result",
      [...ownerArgs(proposal.owner),proposal.key]),
  });
}
