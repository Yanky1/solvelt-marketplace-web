import { brandPath, categoryPath, listingPath } from "./urls";
import { CATALOG_KEY } from "./search";

/**
 * Sitemaps. The API lists what is public (`GET /api/v1/catalog/sitemap/{kind}`: slug and last-modified per entry, in pages); this builds the XML.
 * One child sitemap per page of at most SITEMAP_PAGE_SIZE URLs (the protocol allows 50 000), and an index that names them.
 */
export const SITEMAP_PAGE_SIZE = 1000;
export const SITEMAP_KINDS = ["listings", "categories", "brands"] as const;
export type SitemapKind = (typeof SITEMAP_KINDS)[number];
const MAX_PAGES = 1000;

export interface SitemapEntry { key: string; lastModified: string | null }
export interface SitemapPageData { kind: SitemapKind; page: number; pageSize: number; total: number; totalPages: number; items: SitemapEntry[] }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** A W3C date-time in UTC to the second, or null when the text is not a date. */
export function lastmod(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
}

export const pathFor = (kind: SitemapKind, key: string): string => (kind === "listings" ? listingPath(key) : kind === "categories" ? categoryPath(key) : brandPath(key));

export interface UrlEntry { path: string; lastmod?: string | null }
/** A urlset of absolute, escaped addresses (a plain string is a path with no date). */
export function buildSitemap(origin: string, entries: (string | UrlEntry)[]): string {
  const urls = entries.map((e) => {
    const { path, lastmod: m } = typeof e === "string" ? { path: e, lastmod: null } : e;
    const date = lastmod(m ?? null);
    return `  <url><loc>${esc(origin + path)}</loc>${date ? `<lastmod>${date}</lastmod>` : ""}</url>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function buildSitemapIndex(origin: string, children: string[]): string {
  const items = children.map((c) => `  <sitemap><loc>${esc(origin + c)}</loc></sitemap>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
}

/** The addresses of the child sitemaps for these totals: the static one, then every page of every kind. */
export function childSitemaps(totals: Record<SitemapKind, number>): string[] {
  const out = ["/sitemaps/static/1.xml"];
  for (const kind of SITEMAP_KINDS) {
    const pages = Math.min(MAX_PAGES, Math.ceil(totals[kind] / SITEMAP_PAGE_SIZE));
    for (let p = 1; p <= pages; p++) out.push(`/sitemaps/${kind}/${p}.xml`);
  }
  return out;
}

/** `7.xml` gives 7; anything else is null. */
export function pageFromFile(file: string): number | null {
  const m = /^(\d{1,4})\.xml$/.exec(file);
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= MAX_PAGES ? n : null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

export function parseSitemapPage(json: unknown, kind: SitemapKind): SitemapPageData | null {
  const o = obj(json);
  if (!o || !Array.isArray(o.items)) return null;
  const page = int(o.page), pageSize = int(o.pageSize), total = int(o.total), totalPages = int(o.totalPages);
  if (page === null || pageSize === null || total === null || totalPages === null) return null;
  const items: SitemapEntry[] = [];
  for (const raw of o.items) {
    const e = obj(raw);
    const key = e && typeof e.key === "string" ? e.key : null;
    if (!key || !CATALOG_KEY.test(key)) continue;                                  // an entry we could not put in an address is left out, not the page
    items.push({ key, lastModified: e && typeof e.lastModified === "string" ? e.lastModified : null });
  }
  return { kind, page, pageSize, total, totalPages, items };
}
