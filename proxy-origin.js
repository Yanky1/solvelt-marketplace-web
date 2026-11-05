// The request URL a TLS-terminating proxy (Azure App Service, a load balancer) hides: the proxy speaks https to the browser and plain http to this server, so Express sees http://<host>.
// React Router builds `request.url` from req.protocol and the Host header and, in its single-fetch CSRF guard (throwIfPotentialCSRFAttack), compares it with the browser's `Origin: https://<host>`:
// a mismatch is "Bad Request" and every form action fails with "Unexpected Server Error" (decision M8W-04).
//
// The fix keeps the trust model: X-Forwarded-Proto and X-Forwarded-Host are NEVER read (any peer could send them, and Express's "trust proxy" would trust them). The scheme and the host come from
// PUBLIC_ORIGIN, which the configuration already requires to be https in production and which only the operator sets. A request without an Origin, or with the site's own, gets the site's own URL whatever Host the peer sent;
// a request with a foreign Origin is left untouched, so our own check (not React Router's bare 400) refuses it with the readable page. The CSRF guards keep their meaning: a browser at another origin still sends an Origin that differs from PUBLIC_ORIGIN and is refused.
/** @param {string | undefined} publicOrigin the validated PUBLIC_ORIGIN (scheme://host[:port]); unset or invalid: no change (development without one) */
export function publicOriginMiddleware(publicOrigin) {
  let url;
  try { url = publicOrigin ? new URL(publicOrigin) : null; } catch { url = null; }
  if (!url || !/^https?:$/.test(url.protocol)) return (_req, _res, next) => next();
  const protocol = url.protocol.slice(0, -1);
  const host = url.host;
  return (req, _res, next) => {
    // A request that names another origin (a browser at a second address, a foreign site) is left exactly as it came: its URL then agrees with its own Origin, React Router's guard lets it through and OUR guard
    // (assertSameOrigin, against PUBLIC_ORIGIN) refuses it with the page that tells the visitor to use the official address. Only the site's own origin, or no Origin at all, gets the public URL.
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin !== url.origin) return next();
    Object.defineProperty(req, "protocol", { value: protocol, configurable: true });   // Express reads this from the socket (http) unless "trust proxy" is on, which it must never be here
    req.headers.host = host;
    next();
  };
}
