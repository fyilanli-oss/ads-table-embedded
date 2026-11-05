import type {ActionFunctionArgs,LoaderFunctionArgs} from "react-router";
import {handleCustomerSourceWorkerRequest} from "../lib/privacy/customer-source-worker.server.js";
export const config={maxDuration:60,regions:["fra1"]};
export const action=({request}:ActionFunctionArgs)=>handleCustomerSourceWorkerRequest(request);
export const loader=({request}:LoaderFunctionArgs)=>handleCustomerSourceWorkerRequest(request);
