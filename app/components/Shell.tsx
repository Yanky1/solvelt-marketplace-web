import { useState } from "react";
import { Form, Link, useLocation, useMatches, useRouteLoaderData } from "react-router";
import { Logo } from "./Logo";
import { Button } from "./ui/form";
import { Modal } from "./ui/overlay";
import type { loader as rootLoader } from "~/root";
import type { ThemePref } from "~/lib/theme.server";

// Placeholder until the catalog categories endpoint is wired (W1 catalog slice).
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

export function Header() {
  const [open, setOpen] = useState(false);
  const user = useRootData()?.user;
  // a page that just emptied the cart (the paid confirmation) says so itself: the root loader ran against the old cookie in the same request
  const emptied = useMatches().some((m) => (m.data as { cartEmptied?: boolean } | undefined)?.cartEmptied === true);
  const rootCount = useRootData()?.cartCount ?? 0;
  const cartCount = emptied ? 0 : rootCount;
  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Button className="nav-mobile-toggle" variant="ghost" aria-label="Open menu" onClick={() => setOpen(true)}>☰</Button>
        <Logo />
        <form className="search" role="search" action="/search" method="get">
          <label htmlFor="site-search" className="sr-only">Search Solvelt</label>
          <input id="site-search" name="q" type="search" className="input" placeholder="Search products and services" autoComplete="off" />
          <Button type="submit" variant="primary">Search</Button>
        </form>
        <nav className="nav-desktop" aria-label="Main">
          {NAV_LINKS.map((l) => <Link key={l.to} to={l.to} className="btn btn-ghost">{l.label}</Link>)}
        </nav>
        {user
          ? <Link to="/account" className="btn btn-ghost" aria-label={`Account of ${user.displayName}`}>{user.displayName.split(" ")[0]}</Link>
          : <Link to="/sign-in" className="btn btn-ghost">Sign in</Link>}
        <Link to="/cart" className="btn btn-secondary" aria-label={`Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`}>Cart <span aria-hidden="true" data-testid="cart-count">{cartCount}</span></Link>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Menu" variant="drawer">
        <nav aria-label="Mobile" className="stack" style={{ marginTop: "var(--s2)" }}>
          {NAV_LINKS.map((l) => <Link key={l.to} to={l.to} className="btn btn-ghost" style={{ justifyContent: "flex-start", width: "100%" }} onClick={() => setOpen(false)}>{l.label}</Link>)}
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
          <h2 style={{ fontSize: "var(--fs-lg)" }}>Shop</h2>
          <ul>{NAV_LINKS.map((l) => <li key={l.to}><Link to={l.to}>{l.label}</Link></li>)}</ul>
        </nav>
        <div>
          <h2 style={{ fontSize: "var(--fs-lg)" }}>Appearance</h2>
          <ThemeSwitch theme={theme} />
        </div>
      </div>
    </footer>
  );
}
