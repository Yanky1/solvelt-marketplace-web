import { Link } from "react-router";
import { CategoryLinks, FacetForm, SortForm } from "./Facets";
import { ListingCard } from "./ListingCard";
import { Breadcrumb, EmptyState, Pagination, formatMoney, type Crumb } from "./ui/display";
import { activeFilters, toSearchParams, withChange, type CategoryNode, type ListingPageData, type ListingQuery } from "~/lib/search";
import { categoryPath } from "~/lib/urls";

type Fixed = "category" | "brand" | "seller";

/**
 * The results layout shared by search, category, brand and seller pages: heading and count, active filters, sort, the filter form beside the grid, and
 * pagination. All state is in the address, so every view is a link and nothing here needs a script to work.
 */
export function ListingsPage({ title, intro, crumbs, data, query, basePath, fixed = [], categories, categoriesTitle = "Categories", emptyHint, extra }: {
  title: string; intro?: string | undefined; crumbs?: Crumb[]; data: ListingPageData; query: ListingQuery; basePath: string; fixed?: Fixed[];
  categories?: CategoryNode[]; categoriesTitle?: string; emptyHint?: string; /** Shown between the heading and the results (a seller's brands, say). */ extra?: React.ReactNode;
}) {
  const href = (q: ListingQuery) => { const p = toSearchParams(q, fixed).toString(); return p ? `${basePath}?${p}` : basePath; };
  const chips = activeFilters(query, data.facets, (c) => formatMoney(c));
  const fixedHidden: Record<string, string> = {};
  if (!fixed.includes("category") && query.category) fixedHidden.category = query.category;           // a search narrowed to a category keeps it while filters change
  const cleared: ListingQuery = { ...query, type: undefined, brand: fixed.includes("brand") ? query.brand : undefined, priceMin: undefined, priceMax: undefined, available: false, kosher: [], delivery: [], attr: [], page: 1 };
  const sortHidden: Record<string, string | string[]> = { ...fixedHidden };
  if (query.q) sortHidden.q = query.q;
  if (query.type) sortHidden.type = query.type;
  if (query.brand && !fixed.includes("brand")) sortHidden.brand = query.brand;
  if (query.priceMin !== undefined) sortHidden.priceMin = String(query.priceMin);
  if (query.priceMax !== undefined) sortHidden.priceMax = String(query.priceMax);
  if (query.available) sortHidden.available = "true";
  if (query.kosher.length) sortHidden.kosher = query.kosher;
  if (query.delivery.length) sortHidden.delivery = query.delivery;
  if (query.attr.length) sortHidden.attr = query.attr;
  const noun = data.total === 1 ? "result" : "results";
  return (
    <div className="listings-page">
      {crumbs && <Breadcrumb items={crumbs} />}
      <header className="listings-head">
        <h1>{title}</h1>
        {intro && <p className="listings-intro">{intro}</p>}
      </header>
      {extra}
      <div className="listings-layout">
        <aside className="listings-side" aria-label="Refine results">
          {categories && categories.length > 0 && (
            <nav aria-label={categoriesTitle} className="listings-categories">
              <h2>{categoriesTitle}</h2>
              <CategoryLinks nodes={categories} hrefFor={(slug) => (fixed.includes("category") ? categoryPath(slug) : href(withChange(query, { category: slug })))} current={query.category} />
            </nav>
          )}
          <FacetForm action={basePath} query={query} facets={data.facets} fixedHidden={fixedHidden} hideBrand={fixed.includes("brand")} />
        </aside>
        <section className="listings-main" aria-labelledby="results-heading">
          <div className="listings-toolbar">
            <div role="status"><h2 id="results-heading" className="listings-count">{data.total.toLocaleString("en-US")} {noun}</h2></div>
            <SortForm action={basePath} query={query} hidden={sortHidden} />
          </div>
          {chips.length > 0 && (
            <ul className="filter-chips" aria-label="Active filters">
              {chips.map((c) => <li key={c.key}><Link to={href(c.without)} className="chip">{c.label}<span className="sr-only"> (remove filter)</span><span aria-hidden="true"> ×</span></Link></li>)}
              <li><Link to={href(cleared)} className="chip-clear">Clear all</Link></li>
            </ul>
          )}
          {data.items.length === 0 ? (
            <EmptyState title="No listings match" action={chips.length > 0 ? <Link className="btn btn-secondary" to={href(cleared)}>Clear filters</Link> : undefined}>
              {emptyHint ?? "Try fewer words, check the spelling, or remove a filter."}
            </EmptyState>
          ) : (
            <ul className="listing-grid">{data.items.map((item, i) => <ListingCard key={item.id} item={item} priority={i < 4} />)}</ul>
          )}
          <Pagination page={data.page} pageCount={data.totalPages} hrefFor={(p) => href(withChange(query, { page: p }))} />
        </section>
      </div>
    </div>
  );
}
