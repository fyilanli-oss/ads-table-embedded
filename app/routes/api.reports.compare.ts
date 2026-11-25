import type {ActionFunctionArgs, LoaderFunctionArgs} from "react-router";
import {authenticate, database} from "../shopify.server";
import {handleCompareRequest} from "../lib/reporting/compare-request.server.js";

export const loader = ({request}: LoaderFunctionArgs) =>
  handleCompareRequest(request, {authenticateAdmin: authenticate.admin, database});

export const action = ({request}: ActionFunctionArgs) =>
  handleCompareRequest(request, {authenticateAdmin: authenticate.admin, database});
