import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `The preview could not load this page (${error.status}).`
    : "The preview could not load this page.";

  return (
    <s-page heading="Preview unavailable">
      <s-section heading="Nothing was changed">
        <s-paragraph>{message} No connection or reporting data was modified.</s-paragraph>
      </s-section>
    </s-page>
  );
}
