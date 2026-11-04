import { Link } from "react-router";
import type { Route } from "./+types/categories";
import { JsonLd } from "~/components/JsonLd";
import { Breadcrumb, EmptyState } from "~/components/ui/display";
import { apiCtx } from "~/lib/auth.server";
import { catalog, catalogErrorResponse } from "~/lib/catalog.server";
import { getConfig } from "~/lib/config.server";
import { breadcrumbJsonLd } from "~/lib/seo";
import { categoryPath } from "~/lib/urls";

/** Every category, as links: the way into browsing without searching (and an indexable page that links to every category page). */
export async function loader({ request, context }: Route.LoaderArgs) {
  try {
    return { tree: await catalog.categories(apiCtx(request, context, null)), origin: getConfig().publicOrigin };
  } catch (e) {
    throw catalogErrorResponse(e);
  }
}

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: "All categories | Solvelt" },
    { name: "description", content: "Browse every category on Solvelt Market: food and drink, Judaica and gifts, local services and more." },
    ...(data ? [{ tagName: "link", rel: "canonical", href: data.origin + "/categories" }] : []),
  ];
}

export default function Categories({ loaderData }: Route.ComponentProps) {
  const { tree, origin } = loaderData;
  return (
    <div className="stack">
      <JsonLd data={breadcrumbJsonLd(origin, [{ name: "Home", path: "/" }, { name: "Categories", path: "/categories" }])} />
      <Breadcrumb items={[{ label: "Home", to: "/" }, { label: "Categories" }]} />
      <h1>All categories</h1>
      {tree.length === 0 ? <EmptyState title="No categories yet">Listings will appear here as sellers add them.</EmptyState> : (
        <div className="category-grid">
          {tree.map((root) => (
            <section key={root.id} aria-labelledby={`cat-${root.slug}`} className="card">
              <h2 id={`cat-${root.slug}`}><Link to={categoryPath(root.slug)}>{root.name}</Link> <span className="facet-count">({root.listingCount})</span></h2>
              {root.children.length > 0 && (
                <ul className="category-links">
                  {root.children.map((c) => <li key={c.id}><Link to={categoryPath(c.slug)}>{c.name} <span className="facet-count">({c.listingCount})</span></Link></li>)}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
