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

/** How many top-level categories the desktop bar shows before "All categories"; the mobile menu shows them all. */
export const DESKTOP_CATEGORIES = 6;

/**
 * The header links (W3-03): the top-level catalog categories in the portal's order, server-rendered from the root loader, then "All categories" when the bar cannot show them all, then
 * the fixed links that are not categories. Without categories (the API could not be read) the fixed links alone, as before.
 */
export function navLinks(nav: { slug: string; name: string }[] | undefined, max: number): { to: string; label: string }[] {
  if (!nav || nav.length === 0) return NAV_LINKS;
  const cats = nav.slice(0, max).map((c) => ({ to: `/c/${encodeURIComponent(c.slug)}`, label: c.name }));
  const named = new Set(nav.map((c) => c.name.trim().toLowerCase()));   // a fixed link a category already names (Services) is not shown twice
  return [...cats, { to: "/categories", label: nav.length > max ? "All categories" : "Categories" }, ...NAV_LINKS.filter((l) => l.to !== "/categories" && !named.has(l.label.toLowerCase()))];
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
          {navLinks(nav, DESKTOP_CATEGORIES).map((l) => <Link key={l.to} to={l.to} className="btn btn-ghost">{l.label}</Link>)}
        </nav>
        {user
          ? <Link to="/account" className="btn btn-ghost" aria-label={`Account of ${user.displayName}`}>{user.displayName.split(" ")[0]}</Link>
          : <Link to="/sign-in" className="btn btn-ghost">Sign in</Link>}
        <Link to="/cart" className="btn btn-secondary" aria-label={`Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`}>Cart <span aria-hidden="true" data-testid="cart-count">{cartCount}</span></Link>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Menu" variant="drawer">
        <nav aria-label="Mobile" className="stack u-margin-top-var-s2">
          {navLinks(nav, Number.MAX_SAFE_INTEGER).map((l) => <Link key={l.to} to={l.to} className="btn btn-ghost u-justify-content-flex-start-width-100" onClick={() => setOpen(false)}>{l.label}</Link>)}
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
