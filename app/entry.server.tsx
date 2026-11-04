import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";
import { getConfig } from "~/lib/config.server";

// Fail at start-up (module load) when production config is missing.
getConfig();

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const readyOption = isbot(request.headers.get("user-agent") ?? "") || routerContext.isSpaMode ? "onAllReady" : "onShellReady";
    const { pipe, abort } = renderToPipeableStream(<ServerRouter context={routerContext} url={request.url} />, {
      [readyOption]() {
        shellRendered = true;
        const body = new PassThrough();
        const stream = createReadableStreamFromReadable(body);
        responseHeaders.set("Content-Type", "text/html");
        responseHeaders.set("X-Content-Type-Options", "nosniff");
        responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
        responseHeaders.set("X-Frame-Options", "DENY");
        responseHeaders.append("Vary", "Cookie"); // the theme is rendered from a cookie
        resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
        pipe(body);
      },
      onShellError(error: unknown) {
        reject(error);
      },
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log the error class/message only; never request URLs, headers or bodies (PII/tokens).
        if (shellRendered) console.error("render error:", error instanceof Error ? error.message : "unknown");
      },
    });
    setTimeout(abort, 10_000);
  });
}
