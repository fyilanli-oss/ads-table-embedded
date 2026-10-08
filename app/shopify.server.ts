import {createShopifyAppRuntime} from "./lib/shopify/shopify-app-runtime.server.js";

const runtime = createShopifyAppRuntime();

export const database = runtime.database;
export const publicShopifyConfig = runtime.publicConfig;
export const addDocumentResponseHeaders = runtime.shopify.addDocumentResponseHeaders;
export const authenticate = runtime.shopify.authenticate;
export const sessionStorage = runtime.shopify.sessionStorage;

export default runtime.shopify;
