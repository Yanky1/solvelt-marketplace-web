import { Link } from "react-router";
import type { Route } from "./+types/brands";
import { JsonLd } from "~/components/JsonLd";
import { Breadcrumb, EmptyState } from "~/components/ui/display";
import { apiCtx } from "~/lib/auth.server";
import { catalog, catalogErrorResponse } from "~/lib/catalog.server";
import { getConfig } from "~/lib/config.server";
import { groupBrands } from "~/lib/brands";
import { breadcrumbJsonLd } from "~/lib/seo";
import { brandPath } from "~/lib/urls";

/** Every brand with something to buy, A to Z, each linking to its storefront (/b/:slug). An indexable page that links to every brand page. */
export async function loader({ request, context }: Route.LoaderArgs) {
  try {
    const brands = await catalog.brands(apiCtx(request, context, null));
    return { groups: groupBrands(brands), total: brands.length, origin: getConfig().publicOrigin };
  } catch (e) {
    throw catalogErrorResponse(e);
  }
}

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: "All brands | Solvelt" },
    { name: "description", content: "Every brand on Solvelt Market, from A to Z: independent kosher bakers, Judaica makers, local services and more." },
    ...(data ? [{ tagName: "link", rel: "canonical", href: data.origin + "/brands" }] : []),
  ];
}

export default function Brands({ loaderData }: Route.ComponentProps) {
  const { groups, total, origin } = loaderData;
  return (
    <div className="stack">
      <JsonLd data={breadcrumbJsonLd(origin, [{ name: "Home", path: "/" }, { name: "Brands", path: "/brands" }])} />
      <Breadcrumb items={[{ label: "Home", to: "/" }, { label: "Brands" }]} />
      <h1>All brands</h1>
      {total === 0 ? <EmptyState title="No brands yet">Brands will appear here as sellers list their products and services.</EmptyState> : (
        <>
          <nav aria-label="Jump to a letter" className="brand-letters">
            <ul>{groups.map((g) => <li key={g.letter}><a href={`#brands-${g.letter === "#" ? "other" : g.letter}`}>{g.letter}</a></li>)}</ul>
          </nav>
          {groups.map((g) => (
            <section key={g.letter} id={`brands-${g.letter === "#" ? "other" : g.letter}`} aria-labelledby={`brands-h-${g.letter === "#" ? "other" : g.letter}`} className="card">
              <h2 id={`brands-h-${g.letter === "#" ? "other" : g.letter}`}>{g.letter}</h2>
              <ul className="category-links">
                {g.brands.map((b) => <li key={b.id}><Link to={brandPath(b.slug)}>{b.name} <span className="facet-count">({b.listingCount})</span></Link></li>)}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
