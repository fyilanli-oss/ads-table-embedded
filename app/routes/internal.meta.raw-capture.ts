import type {ActionFunctionArgs,LoaderFunctionArgs} from "react-router";
import {handleMetaRawCaptureRequest} from "../lib/refresh/meta-raw-request.server.js";

// Keep repeated, current SQL authority/quota checks near the eu-central-1 database.
// This isolates placement to the private raw reader, not OAuth or Settings bundles.
export const config={maxDuration:120,regions:["fra1"]};
export const action=({request}:ActionFunctionArgs)=>handleMetaRawCaptureRequest(request);
export const loader=({request}:LoaderFunctionArgs)=>handleMetaRawCaptureRequest(request);
