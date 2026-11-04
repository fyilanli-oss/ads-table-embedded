import type {ActionFunctionArgs,LoaderFunctionArgs} from "react-router";
import {handleGoogleRawCaptureRequest} from "../lib/refresh/google-raw-request.server.js";

export const config={maxDuration:120};
export const action=({request}:ActionFunctionArgs)=>handleGoogleRawCaptureRequest(request);
export const loader=({request}:LoaderFunctionArgs)=>handleGoogleRawCaptureRequest(request);
