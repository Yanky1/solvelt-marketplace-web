import { getConfig } from "~/lib/config.server";

/**
 * What crawlers may fetch. Account, cart and checkout are private. The suggestion route is an API for the search box, not a page. `/search` is deliberately NOT
 * disallowed: its pages say `noindex, follow` themselves (W2-08), and a crawler can only obey that if it may fetch them. Images stay crawlable (they have a
 * place in image search and in link previews).
 */
export function loader() {
  const { publicOrigin } = getConfig();
  const body = [
    "User-agent: *",
    "Disallow: /account",
    "Disallow: /cart",
    "Disallow: /checkout",
    "Disallow: /search/suggest",
    "Allow: /",
    `Sitemap: ${publicOrigin}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
