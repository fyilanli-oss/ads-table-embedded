import assert from "node:assert/strict";
import {handleCompareRequest} from "../app/lib/reporting/compare-request.server.js";

// The caller keeps the fixture and both report publications inside its
// rollback-only transaction. Exercise the real API handler with its SQL role.
export async function readCompareRereadDay(client,owner,day) {
  assert.equal(client.connectionParameters.host,"127.0.0.1");
  assert.equal(Number(client.connectionParameters.port),54322);
  const url=new URL("https://compare.example/api/reports/compare");
  url.search=new URLSearchParams({view:"daily",startDate:day,endDate:day,
    platform:owner.provider,account:owner.accountId});
  const authenticateAdmin=async()=>({
    sessionToken:{dest:`https://${owner.shopDomain}`},
    admin:{graphql:async()=>Response.json({data:{shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain}}})},
  });
  await client.query("savepoint eo06e_compare_read");
  try {
    await client.query("set local role adstable_runtime");
    const request=new Request(url,{headers:{authorization:"Bearer synthetic-compare-session"}});
    const response=await handleCompareRequest(request,{authenticateAdmin,database:client});
    const body=await response.json();
    assert.equal(response.status,200,body.code);
    assert.equal(response.headers.get("cache-control"),"no-store");
    assert.equal(body.version,"compare-v1");
    assert.equal(body.primary.startDate,day);
    assert.equal(body.primary.endDate,day);
    assert.equal(body.comparison,null);
    assert.ok(body.primary.rows.every(row=>row.date===day&&row.platform===owner.provider&&row.accountId===owner.accountId));
    return body.primary.rows;
  } finally {
    await client.query("rollback to savepoint eo06e_compare_read");
    await client.query("release savepoint eo06e_compare_read");
  }
}
