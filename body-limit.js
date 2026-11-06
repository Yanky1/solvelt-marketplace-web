// A cap on the size of a request body, enforced BEFORE anything reads the body into memory (found bug, decision M6W-05).
//
// Without it an anonymous `POST` of hundreds of megabytes is read fully into memory by whatever action calls `request.formData()` (the review photo upload did, before its own 5 MB check and before
// its CSRF check). Two cases, one cap:
//   * a body that DECLARES its size (`Content-Length`) over the cap is refused with 413 before a byte of it is read; the rest the client keeps sending is read and thrown away (never kept) up to a
//     small ceiling (twice the cap), so the client sees the 413 instead of a reset; past the ceiling the connection is cut;
//   * a body with no declared size (chunked) is counted as it passes and the request is cut off (413, connection destroyed) the moment it goes over, so whatever was reading it stops with an error.
// The cap is generous on purpose: the one upload on the site is a 5 MB picture; every other form is a few hundred bytes. The upload route has its own tighter check (app/lib/body-size.server.ts).
export const MAX_BODY_BYTES = 12 * 1024 * 1024;
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** @param {number} [maxBytes] */
export function bodyLimitMiddleware(maxBytes = MAX_BODY_BYTES) {
  const drainCeiling = maxBytes * 2;   // how much of a refused body is read and discarded so the 413 is seen; more than that and the connection is cut
  return (req, res, next) => {
    if (!BODY_METHODS.has(req.method)) return next();
    const declared = req.headers["content-length"];
    if (typeof declared === "string" && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
      refuse(res, undefined, false);      // the connection stays open while the body is thrown away, so the client can finish writing and READ the 413 (closing at once resets a client that is still sending)
      let discarded = 0;
      req.on("data", (chunk) => { discarded += chunk.length; if (discarded > drainCeiling) req.destroy(); });
      req.on("error", () => {});
      req.resume();                       // read and throw away (nothing is kept)
      return;
    }
    // No declared size, or one within the cap: count what actually arrives. The count sits where the HTTP parser hands the body to the request (`push`), not on a "data" listener: a listener would change the
    // stream's flow (pausing it, or starting it before the real reader attaches and taking bytes from it), while this only looks at each chunk on its way in and passes it on unchanged.
    let seen = 0, cut = false;
    const push = req.push;
    req.push = function (chunk, encoding) {
      if (cut) return false;                                      // already refused: nothing more goes on to the reader
      if (chunk) seen += chunk.length;
      if (seen > maxBytes) {
        cut = true;
        refuse(res, () => req.destroy());                         // cut off: whoever is reading the body gets an error and stops
        return false;
      }
      return push.call(this, chunk, encoding);
    };
    next();
  };
}

function refuse(res, after, close = true) {
  if (res.headersSent) { after?.(); return; }
  res.statusCode = 413;
  if (close) res.setHeader("Connection", "close");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("That request is too large.\n", after);
}
