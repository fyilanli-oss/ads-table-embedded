import type {ActionFunctionArgs,LoaderFunctionArgs} from "react-router";
import {handleKlaviyoRawCaptureRequest} from "../lib/refresh/klaviyo-raw-request.server.js";

// Keep repeated, current SQL authority/quota checks near the eu-central-1 database.
// This isolates placement to the private raw reader, not OAuth or Settings bundles.
export const config={maxDuration:180,regions:["fra1"]};
export const action=({request}:ActionFunctionArgs)=>handleKlaviyoRawCaptureRequest(request);
export const loader=({request}:LoaderFunctionArgs)=>handleKlaviyoRawCaptureRequest(request);
