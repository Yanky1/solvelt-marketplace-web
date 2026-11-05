// The request URL a TLS-terminating proxy (Azure App Service, a load balancer) hides: the proxy speaks https to the browser and plain http to this server, so Express sees http://<host>.
// React Router builds `request.url` from req.protocol and the Host header and, in its single-fetch CSRF guard (throwIfPotentialCSRFAttack), compares it with the browser's `Origin: https://<host>`:
// a mismatch is "Bad Request" and every form action fails with "Unexpected Server Error" (decision M8W-04).
//
// The fix keeps the trust model: X-Forwarded-Proto and X-Forwarded-Host are NEVER read (any peer could send them, and Express's "trust proxy" would trust them). The scheme and the host come from
// PUBLIC_ORIGIN, which the configuration already requires to be https in production and which only the operator sets. A Host header that is not the site's own is overwritten, so a request URL is
// always the site's own origin, whatever the peer said. The CSRF guards keep their meaning: a browser at another origin still sends an Origin that differs from PUBLIC_ORIGIN and is refused.
/** @param {string | undefined} publicOrigin the validated PUBLIC_ORIGIN (scheme://host[:port]); unset or invalid: no change (development without one) */
export function publicOriginMiddleware(publicOrigin) {
  let url;
  try { url = publicOrigin ? new URL(publicOrigin) : null; } catch { url = null; }
  if (!url || !/^https?:$/.test(url.protocol)) return (_req, _res, next) => next();
  const protocol = url.protocol.slice(0, -1);
  const host = url.host;
  return (req, _res, next) => {
    Object.defineProperty(req, "protocol", { value: protocol, configurable: true });   // Express reads this from the socket (http) unless "trust proxy" is on, which it must never be here
    req.headers.host = host;
    next();
  };
}
