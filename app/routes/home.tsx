import type { Route } from "./+types/home";
import { JsonLd } from "~/components/JsonLd";
import { LinkButton } from "~/components/ui/form";
import { EmptyState } from "~/components/ui/display";
import { getConfig } from "~/lib/config.server";
import { organizationJsonLd, websiteJsonLd } from "~/lib/seo";

export function loader() {
  return { origin: getConfig().publicOrigin };
}

export function meta({ data }: Route.MetaArgs) {
  const origin = data?.origin ?? "";
  return [
    { title: "Solvelt Market: products and services from independent sellers" },
    { name: "description", content: "Shop products and book services from independent sellers on Solvelt Market." },
    ...(origin ? [{ tagName: "link", rel: "canonical", href: origin + "/" }] : []),
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Solvelt Market" },
    { property: "og:title", content: "Solvelt Market: products and services from independent sellers" },
    { name: "twitter:card", content: "summary" },
  ];
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <div className="stack">
      <JsonLd data={websiteJsonLd(loaderData.origin)} />
      <JsonLd data={organizationJsonLd(loaderData.origin)} />
      <section className="hero">
        <h1>Shop independent sellers, with confidence</h1>
        <p>Products and services from trusted sellers, with kosher-aware filters and one simple checkout.</p>
        <LinkButton to="/categories" className="btn-gold">Browse categories</LinkButton>
      </section>
      <section aria-labelledby="featured">
        <h2 id="featured">Featured</h2>
        <EmptyState title="Listings are on their way">The catalog connects in the next release.</EmptyState>
      </section>
    </div>
  );
}
