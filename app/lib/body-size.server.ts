/**
 * The upload route's own, tighter cap on a request body (found bug, decision M6W-05). The review photo is at most 5 MB; with the multipart framing and the other fields a body over about 6 MB cannot be a
 * legitimate upload. The check reads only the `Content-Length` header, so it runs BEFORE `request.formData()` (which would read the whole body into memory) and before the CSRF check. A body without a declared
 * size (chunked) is cut off by the server's global streaming cap (server.js, `body-limit.js`).
 */
export const UPLOAD_BODY_MAX = 6 * 1024 * 1024;

/** Throws a 413 response when the request declares a body over `maxBytes`; reads nothing from the body. */
export function refuseOversizeBody(request: Request, maxBytes: number): void {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    throw new Response("That upload is too large.", { status: 413, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  }
}
