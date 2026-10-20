// Production-oriented entry point: the database derives scope; no caller-supplied shop/account list.
// This only records work NEEDS. It does not admit claims, verify billing or fetch provider data.
export async function checkRefreshQueueFromAuthority({store}) {
  if(typeof store?.readQueueCheck!=="function" || typeof store?.checkQueueFromAuthority!=="function") throw new Error("REFRESH_INVENTORY_INPUT_INVALID");
  try {
    const state=await store.readQueueCheck();
    if(!state?.configured) return {status:"not_configured"};
    const result=await store.checkQueueFromAuthority({expectedRevision:state.revision});
    return result?.committed===true?{...result,status:"checked"}:{status:"conflict"};
  } catch {return {status:"needs_attention"};}
}
