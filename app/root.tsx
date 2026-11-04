import { data, isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/root";
import { Footer, Header } from "~/components/Shell";
import { ToastProvider } from "~/components/ui/overlay";
import { LinkButton } from "~/components/ui/form";
import { useNonce } from "~/lib/nonce";
import { currentUser, ensureVisitor } from "~/lib/auth.server";
import { parseTheme, type ThemePref } from "~/lib/theme.server";
import "~/styles/app.css";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user, expired } = await currentUser(request, context);
  const visitor = ensureVisitor(request, expired);
  return data(
    {
      // Theme is a cookie, so SSR can emit data-theme and there is no flash of the wrong theme.
      theme: parseTheme(request.headers.get("cookie")) satisfies ThemePref,
      csrf: visitor.csrf,
      // Only what the header needs; never the token, email or addresses.
      user: user ? { displayName: user.displayName } : null,
    },
    // A new visitor (or a dead session) gets a fresh sealed cookie; the API token never leaves the server.
    { headers: visitor.setCookie ? { "Set-Cookie": visitor.setCookie } : {} },
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const theme = data?.theme ?? "system";
  const nonce = useNonce();
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
        <ToastProvider>
          <Header />
          <main id="main" tabIndex={-1} className="container">{children}</main>
          <Footer theme={theme} />
        </ToastProvider>
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <div className="empty">
      <title>{notFound ? "Page not found | Solvelt" : "Something went wrong | Solvelt"}</title>
      <meta name="robots" content="noindex" />
      <h1>{notFound ? "Page not found" : "Something went wrong"}</h1>
      <p className="muted">{notFound ? "The page you are looking for does not exist or has moved." : `An unexpected error occurred (${status}). Please try again.`}</p>
      <LinkButton to="/">Back to home</LinkButton>
    </div>
  );
}
