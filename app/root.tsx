import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/root";
import { Footer, Header } from "~/components/Shell";
import { ToastProvider } from "~/components/ui/overlay";
import { LinkButton } from "~/components/ui/form";
import { parseTheme, type ThemePref } from "~/lib/theme.server";
import "~/styles/app.css";

export function loader({ request }: Route.LoaderArgs) {
  // Theme is a cookie, so SSR can emit data-theme and there is no flash of the wrong theme.
  return { theme: parseTheme(request.headers.get("cookie")) satisfies ThemePref };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const theme = data?.theme ?? "system";
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <Meta />
        <Links />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to main content</a>
        <ToastProvider>
          <Header />
          <main id="main" tabIndex={-1} className="container">{children}</main>
          <Footer theme={theme} />
        </ToastProvider>
        <ScrollRestoration />
        <Scripts />
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
