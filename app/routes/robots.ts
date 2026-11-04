import { getConfig } from "~/lib/config.server";

export function loader() {
  const { publicOrigin } = getConfig();
  const body = [
    "User-agent: *",
    "Disallow: /account",
    "Disallow: /cart",
    "Disallow: /checkout",
    "Disallow: /styleguide",
    "Disallow: /img/",
    "Allow: /",
    `Sitemap: ${publicOrigin}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
