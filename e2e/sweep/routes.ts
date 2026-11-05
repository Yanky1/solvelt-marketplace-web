import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Which routes the sweep visits, and as whom (decision M8W-07). The routes are DISCOVERED from the router (app/routes.ts); each one must be classified here. A route that is in the router and
 * not in this table FAILS the sweep ("not classified"), so a new page can never escape it. Resource routes (a `.ts` file: JSON, images, redirects, downloads) have no UI of their own and are
 * listed with the reason they are not visited.
 */
export type Role = "guest" | "buyer" | "support" | "finance" | "admin";
export const STAFF_ROLES: Role[] = ["support", "finance", "admin"];

export interface World {
  web: string;
  slug: string; listingId: string | null; serviceSlug: string | null; categorySlug: string | null; brandSlug: string | null; sellerId: string | null;
  orderNumber: string | null; bookingId: string | null; addressId: string | null; wishlistId: string | null; searchTerm: string;
  states: Partial<Record<Role, string>>;   // storage-state file per signed-in role
}

export interface Page {
  pattern: string;
  /** the path to open, with the parameters filled from the world; null = no fixture exists (the reason is in `skip`) */
  path: (w: World) => string | null;
  roles: Role[];
  /** HTTP statuses of the page itself that are right for it (default 200) */
  status?: number[];
  skip?: string;
}

const PUBLIC: Role[] = ["guest", "buyer"];
const GUEST: Role[] = ["guest"];
const BUYER: Role[] = ["buyer"];
const ALL_STAFF: Role[] = ["support", "finance", "admin"];

export const PAGES: Page[] = [
  { pattern: "/", path: () => "/", roles: PUBLIC },
  { pattern: "/search", path: (w) => `/search?q=${encodeURIComponent(w.searchTerm)}`, roles: PUBLIC },
  { pattern: "/categories", path: () => "/categories", roles: PUBLIC },
  { pattern: "/services", path: () => "/services", roles: PUBLIC },
  { pattern: "/brands", path: () => "/brands", roles: PUBLIC },
  { pattern: "/c/:slug", path: (w) => (w.categorySlug ? `/c/${w.categorySlug}` : null), roles: PUBLIC },
  { pattern: "/b/:slug", path: (w) => (w.brandSlug ? `/b/${w.brandSlug}` : null), roles: PUBLIC },
  { pattern: "/s/:id", path: (w) => (w.sellerId ? `/s/${w.sellerId}` : null), roles: PUBLIC },
  { pattern: "/p/:slug", path: (w) => `/p/${w.slug}`, roles: PUBLIC },
  { pattern: "/cart", path: () => "/cart", roles: PUBLIC },
  { pattern: "/checkout", path: () => "/checkout", roles: PUBLIC },
  { pattern: "/styleguide", path: () => "/styleguide", roles: PUBLIC },
  { pattern: "/sign-in", path: () => "/sign-in", roles: GUEST },
  { pattern: "/sign-up", path: () => "/sign-up", roles: GUEST },
  { pattern: "/forgot-password", path: () => "/forgot-password", roles: GUEST },
  { pattern: "/reset-password", path: () => "/reset-password", roles: GUEST },
  { pattern: "/verify-email", path: () => "/verify-email", roles: GUEST },
  { pattern: "/unsubscribe", path: () => "/unsubscribe", roles: GUEST },
  { pattern: "/resend-verification", path: () => null, roles: [], skip: "a form POST target with no page of its own (resource route in practice: `.tsx` with only an action)" },
  { pattern: "/staff/sign-in", path: () => "/staff/sign-in", roles: GUEST },
  { pattern: "/staff/enrol", path: () => "/staff/enrol", roles: GUEST },
  { pattern: "/staff", path: () => "/staff", roles: ALL_STAFF },
  { pattern: "/staff/confirm", path: () => "/staff/confirm", roles: ALL_STAFF },
  { pattern: "/staff/buyers", path: () => "/staff/buyers", roles: ALL_STAFF },
  { pattern: "/staff/orders", path: () => "/staff/orders", roles: ALL_STAFF },
  { pattern: "/staff/queues", path: () => "/staff/queues", roles: ALL_STAFF },
  { pattern: "/staff/accounts", path: () => "/staff/accounts", roles: ALL_STAFF, status: [200, 403] },
  { pattern: "/staff/audit", path: () => "/staff/audit", roles: ALL_STAFF, status: [200, 403] },
  { pattern: "/account", path: () => "/account", roles: BUYER },
  { pattern: "/account/confirm", path: () => "/account/confirm", roles: BUYER },
  { pattern: "/account/profile", path: () => "/account/profile", roles: BUYER },
  { pattern: "/account/addresses", path: () => "/account/addresses", roles: BUYER },
  { pattern: "/account/addresses/new", path: () => "/account/addresses/new", roles: BUYER },
  { pattern: "/account/addresses/:id", path: (w) => (w.addressId ? `/account/addresses/${w.addressId}` : null), roles: BUYER },
  { pattern: "/account/wishlists", path: () => "/account/wishlists", roles: BUYER },
  { pattern: "/account/wishlists/:id", path: (w) => (w.wishlistId ? `/account/wishlists/${w.wishlistId}` : null), roles: BUYER },
  { pattern: "/wishlists/shared/:key", path: () => null, roles: [], skip: "needs a share key, which exists only after a buyer shares a list (covered by the web e2e)" },
  { pattern: "/account/reviews", path: () => "/account/reviews", roles: BUYER },
  { pattern: "/account/reviews/new", path: () => "/account/reviews/new", roles: BUYER, status: [200, 302, 404] },
  { pattern: "/account/reviews/:id", path: () => null, roles: [], skip: "needs a published review (the product journey writes one in its own database; the sweep world has none)" },
  { pattern: "/account/questions", path: () => "/account/questions", roles: BUYER },
  { pattern: "/account/orders", path: () => "/account/orders", roles: BUYER },
  { pattern: "/account/orders/:number", path: (w) => (w.orderNumber ? `/account/orders/${w.orderNumber}` : null), roles: BUYER },
  { pattern: "/account/messages", path: () => "/account/messages", roles: BUYER },
  { pattern: "/account/messages/new", path: (w) => (w.listingId ? `/account/messages/new?listing=${w.listingId}` : null), roles: BUYER },
  { pattern: "/account/messages/:id", path: () => null, roles: [], skip: "needs a message thread; none exists in the sweep world" },
  { pattern: "/account/notifications", path: () => "/account/notifications", roles: BUYER },
  { pattern: "/account/notifications/preferences", path: () => "/account/notifications/preferences", roles: BUYER },
  { pattern: "/account/demo", path: () => "/account/demo", roles: BUYER },
  { pattern: "/account/demo/remove", path: () => null, roles: [], skip: "a destructive action page (removes the test data)" },
  { pattern: "/account/passkeys", path: () => "/account/passkeys", roles: BUYER },
  { pattern: "/account/passkeys/remove-all", path: () => null, roles: [], skip: "a destructive action page (removes every passkey)" },
  { pattern: "/account/privacy", path: () => "/account/privacy", roles: BUYER },
  { pattern: "/account/password", path: () => "/account/password", roles: BUYER },
  { pattern: "/account/bookings", path: () => "/account/bookings", roles: BUYER },
  { pattern: "/account/quotes", path: () => "/account/quotes", roles: BUYER },
  { pattern: "/bookings/:id", path: (w) => (w.bookingId ? `/bookings/${w.bookingId}` : null), roles: BUYER },
  { pattern: "/quotes/:id", path: () => null, roles: [], skip: "needs a quote; none exists in the sweep world" },
  { pattern: "/checkout/confirmation/:number", path: (w) => (w.orderNumber ? `/checkout/confirmation/${w.orderNumber}` : null), roles: BUYER },
  { pattern: "/orders/:number", path: () => null, roles: [], skip: "the guest order link needs its one-time token (covered by the web e2e)" },
  { pattern: "*", path: () => "/this-page-does-not-exist", roles: PUBLIC, status: [404] },
];

/** Routes with no page of their own: a `.ts` file (JSON, images, downloads, redirects, form targets). Not visited, with the reason. */
const RESOURCE_REASON = "a resource route (a `.ts` file: data, image, download, redirect or form target): it has no UI to look at";

export interface Discovered { pattern: string; file: string }

/** The routes the router declares, read from app/routes.ts (nested `route()` calls included: the path is joined to the parent's). */
export function discoverRoutes(root = process.cwd()): Discovered[] {
  const src = readFileSync(join(root, "app", "routes.ts"), "utf8");
  const out: Discovered[] = [];
  const stack: string[] = [];
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    const idx = /^index\("([^"]+)"\)/.exec(line);
    if (idx) { out.push({ pattern: "/" + stack.join("/"), file: idx[1]! }); continue; }
    const r = /^route\("([^"]+)",\s*"([^"]+)"(,\s*\[)?/.exec(line);
    if (r) {
      if (r[3]) { stack.push(r[1]!); continue; }   // a layout route (it has children): not a page of its own; its index route is
      const full = r[1] === "*" ? "*" : "/" + [...stack, r[1]!].join("/");
      out.push({ pattern: full.replace(/\/+/g, "/"), file: r[2]! });
      continue;
    }
    if (line.startsWith("]") && stack.length) stack.pop();
  }
  return out;
}

export interface Plan { visits: Array<{ page: Page; role: Role }>; skipped: Array<{ pattern: string; reason: string }>; unclassified: string[] }

/** Joins the router with the table: what to visit, what is skipped (and why), and what nobody classified. */
export function plan(root = process.cwd()): Plan {
  const found = discoverRoutes(root);
  const byPattern = new Map(PAGES.map((p) => [p.pattern, p]));
  const visits: Plan["visits"] = [];
  const skipped: Plan["skipped"] = [];
  const unclassified: string[] = [];
  for (const d of found) {
    const page = byPattern.get(d.pattern);
    if (page) {
      if (page.skip) skipped.push({ pattern: d.pattern, reason: page.skip });
      for (const role of page.roles) visits.push({ page, role });
      continue;
    }
    if (d.file.endsWith(".ts")) { skipped.push({ pattern: d.pattern, reason: RESOURCE_REASON }); continue; }
    unclassified.push(d.pattern);
  }
  // a classified page that the router no longer has is a stale table entry
  for (const p of PAGES) if (!found.some((d) => d.pattern === p.pattern)) unclassified.push(`${p.pattern} (in the table, not in the router)`);
  return { visits, skipped, unclassified };
}
