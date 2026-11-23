import { SearchBox } from "./SearchBox";
import { useState } from "react";
import { Form, Link, useLocation, useMatches, useRouteLoaderData } from "react-router";
import { Logo } from "./Logo";
import { Button } from "./ui/form";
import { Badge } from "./ui/display";
import { Modal } from "./ui/overlay";
import type { loader as rootLoader } from "~/root";
import type { ThemePref } from "~/lib/theme.server";

// The fixed links: always after the category links, and the whole header when the categories cannot be read (W3-03).
export const NAV_LINKS = [
  { to: "/categories", label: "Categories" },
  { to: "/services", label: "Services" },
  { to: "/brands", label: "Brands" },
];

export function useRootData() {
  return useRouteLoaderData<typeof rootLoader>("root");
}

export function CsrfField() {
  return <input type="hidden" name="csrf" value={useRootData()?.csrf ?? ""} />;
}

function ThemeSwitch({ theme }: { theme: ThemePref }) {
  const location = useLocation();
  return (
    <Form method="post" action="/theme" className="row" aria-label="Theme">
      <CsrfField />
      <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
      {(["system", "light", "dark"] as const).map((t) => (
        <Button key={t} type="submit" name="theme" value={t} variant={theme === t ? "primary" : "secondary"} aria-pressed={theme === t}>
          {t[0]?.toUpperCase() + t.slice(1)}
        </Button>
      ))}
    </Form>
  );
}

type NavItem = { slug: string; name: string };

/** The category links (W3-03): the top-level catalog categories in the portal's order, server-rendered from the root loader. */
export function categoryLinks(nav: NavItem[] | undefined): { to: string; label: string }[] {
  return (nav ?? []).map((c) => ({ to: `/c/${encodeURIComponent(c.slug)}`, label: c.name }));
}

/**
 * The top bar's own links: the fixed ones, minus any a category already names (Services is a top-level category: it is in the category row, not twice). Without categories (the API could
 * not be read) the fixed links alone, as before.
 */
export function mainLinks(nav: NavItem[] | undefined): { to: string; label: string }[] {
  if (!nav || nav.length === 0) return NAV_LINKS;
  const named = new Set(nav.map((c) => c.name.trim().toLowerCase()));
  return NAV_LINKS.filter((l) => !named.has(l.label.toLowerCase()));
}

export function Header() {
  const [open, setOpen] = useState(false);
  const user = useRootData()?.user;
  const nav = useRootData()?.nav;
  const testMode = useRootData()?.demo?.badge === true;
  // a page that just emptied the cart (the paid confirmation) says so itself: the root loader ran against the old cookie in the same request
  const emptied = useMatches().some((m) => (m.data as { cartEmptied?: boolean } | undefined)?.cartEmptied === true);
  const rootCount = useRootData()?.cartCount ?? 0;
  const cartCount = emptied ? 0 : rootCount;
  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Button className="nav-mobile-toggle" variant="ghost" aria-label="Open menu" onClick={() => setOpen(true)}>☰</Button>
        <Logo />
        {testMode && <span className="test-mode" data-testid="test-mode-badge"><Badge tone="gold">TEST MODE</Badge></span>}
        <SearchBox />
        <nav className="nav-desktop" aria-label="Main">
          {mainLinks(nav).map((l) => <Link key={l.to} to={l.to} className="btn btn-ghost">{l.label}</Link>)}
        </nav>
        {user
          ? <Link to="/account" className="btn btn-ghost" aria-label={`Account of ${user.displayName}`}>{user.displayName.split(" ")[0]}</Link>
          : <Link to="/sign-in" className="btn btn-ghost">Sign in</Link>}
        <Link to="/cart" className="btn btn-secondary" aria-label={`Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`}>Cart <span aria-hidden="true" data-testid="cart-count">{cartCount}</span></Link>
      </div>
      {/* the category row (W3-03): wide screens only; it scrolls inside itself when the categories do not fit, never the page. The mobile menu lists them instead. */}
      {categoryLinks(nav).length > 0 && (
        <nav className="catbar" aria-label="Shop by category">
          <div className="container catbar-inner">
            {categoryLinks(nav).map((l) => <Link key={l.to} to={l.to} className="btn btn-ghost">{l.label}</Link>)}
          </div>
        </nav>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Menu" variant="drawer">
        <nav aria-label="Mobile" className="stack u-margin-top-var-s2">
          {[...categoryLinks(nav), ...mainLinks(nav)].map((l) => <Link key={l.to} to={l.to} className="btn btn-ghost u-justify-content-flex-start-width-100" onClick={() => setOpen(false)}>{l.label}</Link>)}
        </nav>
      </Modal>
    </header>
  );
}

export function Footer({ theme }: { theme: ThemePref }) {
  return (
    <footer className="footer">
      <div className="container footer-cols">
        <div>
          <Logo />
          <p className="muted">Products and services from independent sellers, with kosher-aware filters.</p>
        </div>
        <nav aria-label="Footer">
          <h2 className="u-font-size-var-fs-lg">Shop</h2>
          <ul>{NAV_LINKS.map((l) => <li key={l.to}><Link to={l.to}>{l.label}</Link></li>)}</ul>
        </nav>
        <div>
          <h2 className="u-font-size-var-fs-lg">Appearance</h2>
          <ThemeSwitch theme={theme} />
        </div>
      </div>
    </footer>
  );
}
