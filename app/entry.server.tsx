import {PassThrough} from "node:stream";
import {createReadableStreamFromReadable} from "@react-router/node";
import {renderToPipeableStream} from "react-dom/server";
import {ServerRouter, type EntryContext, type HandleErrorFunction} from "react-router";
import {isbot} from "isbot";
import {addDocumentResponseHeaders} from "./shopify.server";
import {handleServerError, logServerFailure} from "./lib/server-error-log.server.js";

export const handleError: HandleErrorFunction = handleServerError;

const STREAM_TIMEOUT_MS = 5000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const callbackName = isbot(request.headers.get("user-agent") ?? "")
    ? "onAllReady"
    : "onShellReady";

  return new Promise<Response>((resolve, reject) => {
    const {pipe, abort} = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(new Response(stream, {headers: responseHeaders, status: responseStatusCode}));
          pipe(body);
        },
        onShellError: reject,
        onError() {
          responseStatusCode = 500;
          logServerFailure("render", request);
        },
      },
    );

    setTimeout(abort, STREAM_TIMEOUT_MS);
  });
}
