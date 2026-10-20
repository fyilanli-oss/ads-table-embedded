import type {ActionFunctionArgs,LoaderFunctionArgs} from "react-router";
import {handleQueueCronRequest} from "../lib/refresh/queue-cron-entry.server.js";

export const loader=({request}:LoaderFunctionArgs)=>handleQueueCronRequest(request);
export const action=({request}:ActionFunctionArgs)=>handleQueueCronRequest(request);
