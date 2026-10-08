import {createHash} from "node:crypto";

const SHOP_ID_PATTERN = /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/;

export function shopIdentitySha256(shopId) {
  if (typeof shopId !== "string" || !SHOP_ID_PATTERN.test(shopId)) {
    throw new TypeError("shopId must be a canonical Shopify Shop GID");
  }
  return createHash("sha256").update(shopId, "utf8").digest();
}
