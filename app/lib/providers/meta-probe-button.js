// Temporary client-only transport. Authority and all provider calls remain server-side.
export const META_PROBE_BUTTON_INPUT = Object.freeze({
  provider: "meta",
  business_date: "2026-10-01",
  probe: "promoted_product_metrics",
});

const failure = (code) => Object.freeze({status: "failed", code});
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;

export function createMetaProbeButtonRunner({fetchFn = (...args) => fetch(...args)} = {}) {
  let attempted = false;
  return Object.freeze({
    get attempted() {return attempted;},
    async run() {
      if (attempted) return null;
      attempted = true;
      try {
        const response = await fetchFn("/settings/provider-live-evidence", {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify(META_PROBE_BUTTON_INPUT),
        });
        // Authentication redirects must never be followed by a second attempt.
        if (response.redirected) return failure("META_PROBE_RESPONSE_INVALID");
        const result = await response.json();
        if (!response.ok || result?.status !== "complete") {
          return failure(typeof result?.code === "string" && /^[A-Z0-9_]{1,100}$/.test(result.code)
            ? result.code : "META_PROBE_REQUEST_FAILED");
        }
        if (result.provider !== META_PROBE_BUTTON_INPUT.provider
          || result.business_date !== META_PROBE_BUTTON_INPUT.business_date
          || result.probe !== META_PROBE_BUTTON_INPUT.probe
          || result.publishable_to_dataset_v2 !== false
          || !validCount(result.channel?.row_count) || !validCount(result.product?.row_count)) {
          return failure("META_PROBE_RESPONSE_INVALID");
        }
        // Never store or expose the response's identities, hashes, metrics or raw rows in UI state.
        return Object.freeze({status: "complete",
          channelRows: result.channel.row_count, productRows: result.product.row_count});
      } catch {
        return failure("META_PROBE_REQUEST_FAILED");
      }
    },
  });
}
