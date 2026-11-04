import { getConfig } from "~/lib/config.server";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildSitemap(origin: string, paths: string[]): string {
  const urls = paths.map((p) => `  <url><loc>${esc(origin + p)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// Catalog-driven entries (categories, brands, listings) are added in the catalog slice.
export function loader() {
  const { publicOrigin } = getConfig();
  return new Response(buildSitemap(publicOrigin, ["/"]), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
