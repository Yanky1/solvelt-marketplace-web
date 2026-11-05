import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, type AppLoadContext, type EntryContext } from "react-router";
import { getConfig, stripeScriptOrigins as originsFor } from "~/lib/config.server";
import { ApiError } from "~/lib/api-client.server";
import { noteFailure, refCookie, routePattern } from "~/lib/error-ref.server";
import { NonceContext } from "~/lib/nonce";
import { isStaffPath } from "~/lib/staff-path";

// Fail at start-up (module load) when production config is missing.
const config = getConfig();

/** The script/frame origins the checkout page may load Stripe.js from, from the VALIDATED config (server.js builds the CSP from this, never from process.env). */
export const stripeScriptOrigins: string[] = originsFor(config.stripeJsUrl);

const ABORT_DELAY_MS = 10_000;

/** Security headers (CSP, nosniff, ...) are set once in server.js; this file owns caching and Vary. */
export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext?: AppLoadContext,
) {
  const nonce = loadContext?.nonce ?? "";
  // A failed page: the reference rides in a short-lived cookie, read by the error page after it hydrates (decision M8W-03). It cannot go into the page's own data: React Router has already
  // serialized that for the browser when this runs, and a value only the server HTML had would be dropped at hydration.
  const ref = loadContext?.errorRef?.id;
  const failed = responseStatusCode >= 500 || Object.keys(routerContext.staticHandlerContext?.errors ?? {}).length > 0;
  if (ref && failed) responseHeaders.append("Set-Cookie", refCookie(ref, config.publicOrigin.startsWith("https://")));
  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const readyOption = isbot(request.headers.get("user-agent") ?? "") || routerContext.isSpaMode ? "onAllReady" : "onShellReady";
    const { pipe, abort } = renderToPipeableStream(
      <NonceContext.Provider value={nonce}>
        <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
      </NonceContext.Provider>,
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          responseHeaders.append("Vary", "Cookie"); // the theme is rendered from a cookie
          if (isStaffPath(new URL(request.url).pathname)) { responseHeaders.set("Cache-Control", "private, no-store"); responseHeaders.set("X-Robots-Tag", "noindex, nofollow"); }   // the staff area: never stored, never indexed (M7W-02)
          // Personalised pages must never be served from a shared cache; routes may override with something stricter.
          if (!responseHeaders.has("Cache-Control")) responseHeaders.set("Cache-Control", "private, no-cache");
          // Bots get onAllReady (complete HTML, no streaming), browsers onShellReady; both end the abort timer with the stream.
          body.on("close", () => clearTimeout(timer));
          resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
          pipe(body);
        },
        onShellError(error: unknown) {
          clearTimeout(timer);
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log the error class/message only; never request URLs, headers or bodies (PII/tokens).
          if (shellRendered) console.error("render error:", error instanceof Error ? error.message : "unknown");
        },
      },
    );
    const timer = setTimeout(abort, ABORT_DELAY_MS);
    timer.unref();
  });
}

/** Every unhandled error of a loader or action lands here (a page or a `.data` request). One log line with the reference; never a query string, header or body. */
export function handleError(error: unknown, { request, context }: { request: Request; context: AppLoadContext }) {
  if (request.signal?.aborted) return;   // the browser went away: not a failure
  const api = error instanceof ApiError ? error : undefined;
  noteFailure(context?.errorRef, {
    source: api ? "api" : "bff", status: api?.status ?? 500, code: api?.code, route: routePattern(request.url), apiRef: api?.reference,
    kind: "unhandled", ...(api ? {} : { code: error instanceof Error ? error.name : "unknown" }),
  });
}

/** Single-fetch `.data` responses depend on the cookie (theme now, user data later): never shared-cacheable. */
export function handleDataRequest(response: Response, { context }: { context?: AppLoadContext } = {}) {
  response.headers.append("Vary", "Cookie");
  // Keep a stricter no-store set by the route (account pages); otherwise never shared-cacheable.
  if (!/no-store/i.test(response.headers.get("Cache-Control") ?? "")) response.headers.set("Cache-Control", "private, no-cache");
  // A failed client-side request: the error page (rendered in the browser) cannot see the server's holder, so the reference rides in a short-lived cookie it reads and clears.
  const ref = context?.errorRef?.id;
  if (ref && response.status >= 500) response.headers.append("Set-Cookie", refCookie(ref, config.publicOrigin.startsWith("https://")));
  return response;
}
