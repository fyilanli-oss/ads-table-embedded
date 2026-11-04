import type {ActionFunctionArgs,LoaderFunctionArgs} from "react-router";
import {handleGoogleMerchantServerRequest} from "../lib/refresh/google-merchant-request.server.js";
export const config={maxDuration:60};
export const loader=({request}:LoaderFunctionArgs)=>handleGoogleMerchantServerRequest(request);
export const action=({request}:ActionFunctionArgs)=>handleGoogleMerchantServerRequest(request);
