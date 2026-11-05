import { useEffect, useState } from "react";
import { data, isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation, useRouteLoaderData } from "react-router";
import { Logo } from "~/components/Logo";
import type { Route } from "./+types/root";
import { Footer, Header } from "~/components/Shell";
import { ToastProvider } from "~/components/ui/overlay";
import { Button, LinkButton } from "~/components/ui/form";
import { useNonce } from "~/lib/nonce";
import { isStaffPath } from "~/lib/staff-path";
import { apiCtx, currentUser, ensureVisitor } from "~/lib/auth.server";
import { demoMode } from "~/lib/demo.server";
import { reconcileUserStorageInBrowser } from "~/lib/client-storage";
import { MergeGuestViews } from "~/components/RecentlyViewed";
import { parseTheme, type ThemePref } from "~/lib/theme.server";
import "~/styles/app.css";

/**
 * Error documents (404/503 thrown by account pages) are rendered by this route's boundary, so the thrown response's
 * Cache-Control (no-store) must be carried over here or it would be lost.
 */
export function headers({ errorHeaders }: Route.HeadersArgs) {
  const cc = errorHeaders?.get("Cache-Control");
  return cc ? { "Cache-Control": cc } : {};
}

export async function loader({ request, context }: Route.LoaderArgs) {
  // The staff area (M7W-01) has its own session: no buyer visitor cookie, no buyer API call and no test-mode lookup on its pages.
  if (isStaffPath(new URL(request.url).pathname)) {
    return data({ theme: parseTheme(request.headers.get("cookie")) satisfies ThemePref, csrf: "", cartCount: 0, user: null, demo: { badge: false, buttons: false } });
  }
  const { user, expired } = await currentUser(request, context);
  const visitor = ensureVisitor(request, expired);
  return data(
    {
      // Theme is a cookie, so SSR can emit data-theme and there is no flash of the wrong theme.
      theme: parseTheme(request.headers.get("cookie")) satisfies ThemePref,
      csrf: visitor.csrf,
      // The item count the cart last reported (kept in the sealed session cookie, so no API call per page); never the guest cart token.
      cartCount: visitor.session.cn ?? 0,
      // Only what the header needs; never the token, email or addresses.
      // Opaque id (not secret) lets the browser notice a different or vanished user and clear user-scoped storage.
      user: user ? { id: user.id, displayName: user.displayName } : null,
      // Test mode (M9): the badge shows when the API says so; the demo buttons only when this server agrees too. Never anything secret.
      demo: await demoMode(apiCtx(request, context, null)),
    },
    // A new visitor (or a dead session) gets a fresh sealed cookie; the API token never leaves the server.
    { headers: visitor.setCookie ? { "Set-Cookie": visitor.setCookie } : {} },
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const theme = data?.theme ?? "system";
  const nonce = useNonce();
  const userId = data?.user?.id ?? null;
  const staff = isStaffPath(useLocation().pathname);
  useEffect(() => { reconcileUserStorageInBrowser(userId); }, [userId]);
  // A deterministic "React has hydrated" signal (tests wait for it before touching forms; nothing else uses it).
  useEffect(() => { document.documentElement.dataset.hydrated = "true"; }, []);
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <Meta />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <Links />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to main content</a>
        {staff ? (
          // The staff area has its own minimal chrome (M7W-07): no buyer search, cart, sign-in or theme form (the buyer's theme form posts the BUYER's CSRF token, which a staff page does not have).
          <>
            <header className="topbar"><div className="container topbar-inner"><Logo /></div></header>
            <main id="main" tabIndex={-1} className="container">{children}</main>
          </>
        ) : (
          <ToastProvider>
            <Header />
            <MergeGuestViews />
            <main id="main" tabIndex={-1} className="container">{children}</main>
            <Footer theme={theme} />
          </ToastProvider>
        )}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/** "Reference: <id>" with a copy button: what a buyer reads out so the failure can be found in the logs. The server sends it in a short-lived cookie (a failed page or a failed client-side request); it is read once, after hydration. */
function ErrorReference() {
  const [ref, setRef] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (ref) return;
    const m = /(?:^|;\s*)sl_ref=([A-Za-z0-9._:-]{4,64})/.exec(document.cookie);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the cookie exists only in the browser: reading it during render would differ from the server's HTML (hydration)
    if (m) { setRef(m[1]); document.cookie = "sl_ref=; Path=/; Max-Age=0"; }   // read once: a later, unrelated error must not show an old reference
  }, [ref]);
  if (!ref) return null;
  return (
    <p className="muted" data-testid="error-reference">
      Reference: <code>{ref}</code>{" "}
      <Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(ref).then(() => setCopied(true)).catch(() => {}); }}>
        {copied ? "Copied" : "Copy reference"}
      </Button>
    </p>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const status = isRouteErrorResponse(error) ? error.status : 500;
  if (isRouteErrorResponse(error) && error.status === 403) {
    // A stale or missing CSRF token (form left open, another tab signed in or out): ask for a retry instead of a bare "Forbidden".
    // Two causes are about the browser's connection to the site, not the form: the page was opened at an address other than the site's own, or the session cookie did not come back.
    const why = typeof error.data === "string" ? error.data : "";
    const message = why === "origin_mismatch" || why === "no_origin"
      ? "This page was opened at an address that is not the site's own, so we could not confirm your request. Nothing was changed. Open the site at its official address (https) and try again."
      : why === "no_session"
        ? "Your browser did not send back its session cookie, so we could not confirm your request. Nothing was changed. Check that cookies are allowed for this site and that you are using its secure (https) address, then try again."
        : "This page was open for a while or in another tab, so we could not confirm your request. Nothing was changed. Go back, reload the page and submit again.";
    return (
      <div className="empty">
        <title>Please try again | Solvelt</title>
        <meta name="robots" content="noindex" />
        <h1>Please try again</h1>
        <p className="muted">{message}</p>
        <LinkButton to="/">Back to home</LinkButton>
      </div>
    );
  }
  if (isRouteErrorResponse(error) && error.status === 410) {
    // A listing that was public and is gone for good (unlisted, archived): a 410 tells search engines to drop it.
    return (
      <div className="empty">
        <title>No longer available | Solvelt</title>
        <meta name="robots" content="noindex" />
        <h1>This item is no longer available</h1>
        <p className="muted">The seller has taken it down. You can look for something similar.</p>
        <LinkButton to="/search">Search the marketplace</LinkButton>
      </div>
    );
  }
  return (
    <div className="empty">
      <title>{notFound ? "Page not found | Solvelt" : "Something went wrong | Solvelt"}</title>
      <meta name="robots" content="noindex" />
      <h1>{notFound ? "Page not found" : "Something went wrong"}</h1>
      <p className="muted">{notFound ? "The page you are looking for does not exist or has moved." : `An unexpected error occurred (${status}). Please try again.`}</p>
      {!notFound && <ErrorReference />}
      <LinkButton to="/">Back to home</LinkButton>
    </div>
  );
}
