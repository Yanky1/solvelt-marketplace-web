import { useEffect, useRef } from "react";
import { Form, Link, useSubmit } from "react-router";
import { Button } from "./ui/form";
import { formatMoney } from "./ui/display";
import { DELIVERY_LABELS, SORTS, SORT_LABELS, effectiveSort, hasFilters, type CategoryNode, type Facets as FacetData, type ListingQuery } from "~/lib/search";

const dollars = (cents: number | undefined) => (cents === undefined ? "" : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2));

/**
 * The filter form: a plain GET form (it works without JavaScript, and every choice is an address you can share). Checkboxes and radios apply as soon as they
 * change; the price fields and the button apply on submit. On a narrow screen it sits in a closed `<details>`; on a wide one it is simply open.
 */
export function FacetForm({ action, query, facets, fixedHidden }: { action: string; query: ListingQuery; facets: FacetData | null; fixedHidden: Record<string, string> }) {
  const submit = useSubmit();
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (window.matchMedia?.("(max-width: 899px)").matches && details.current) details.current.open = false; }, []);   // closed on a phone, open everywhere else (and without JS)
  const kosher = facets?.attributes["kosher-certification"] ?? [];
  const delivery = (facets?.attributes["delivery"] ?? []).filter((d) => d.value in DELIVERY_LABELS);
  const brands = facets?.brands ?? [];
  const types = facets?.types ?? [];
  const onChange = (e: React.ChangeEvent<HTMLFormElement>) => { const t = e.target as unknown as HTMLInputElement; if (t.type === "checkbox" || t.type === "radio") submit(e.currentTarget, { preventScrollReset: true }); };
  return (
    <details className="facets" ref={details} open>
      <summary className="facets-summary">Filters{hasFilters(query) ? " (active)" : ""}</summary>
      <Form method="get" action={action} onChange={onChange} className="facets-form" aria-label="Filter results">
        {Object.entries(fixedHidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {query.q && <input type="hidden" name="q" value={query.q} />}
        {query.sort && <input type="hidden" name="sort" value={query.sort} />}
        {types.length > 1 && (
          <fieldset>
            <legend>Type</legend>
            <label className="facet-option"><input type="radio" name="type" value="" defaultChecked={!query.type} /> All</label>
            {types.map((t) => <label key={t.value} className="facet-option"><input type="radio" name="type" value={t.value} defaultChecked={query.type === t.value} /> {t.value === "service" ? "Services" : "Products"} <span className="facet-count">({t.count})</span></label>)}
          </fieldset>
        )}
        <fieldset>
          <legend>Availability</legend>
          <label className="facet-option"><input type="checkbox" name="available" value="true" defaultChecked={query.available} /> In stock only{facets ? <> <span className="facet-count">({facets.available})</span></> : null}</label>
        </fieldset>
        <fieldset>
          <legend>Price</legend>
          <div className="facet-price">
            <label>Min <span className="sr-only">price in dollars</span><input name="priceMinD" inputMode="decimal" defaultValue={dollars(query.priceMin)} placeholder={facets?.price ? dollars(facets.price.minCents) : "0"} pattern="\d{0,10}(\.\d{1,2})?" /></label>
            <label>Max <span className="sr-only">price in dollars</span><input name="priceMaxD" inputMode="decimal" defaultValue={dollars(query.priceMax)} placeholder={facets?.price ? dollars(facets.price.maxCents) : ""} pattern="\d{0,10}(\.\d{1,2})?" /></label>
          </div>
          {facets?.price && <p className="facet-hint">{formatMoney(facets.price.minCents)} to {formatMoney(facets.price.maxCents)} in these results</p>}
        </fieldset>
        {brands.length > 0 && (
          <fieldset>
            <legend>Brand</legend>
            <label className="facet-option"><input type="radio" name="brand" value="" defaultChecked={!query.brand} /> Any brand</label>
            {brands.map((b) => <label key={b.slug} className="facet-option"><input type="radio" name="brand" value={b.slug} defaultChecked={query.brand === b.slug} /> {b.name} <span className="facet-count">({b.count})</span></label>)}
          </fieldset>
        )}
        {kosher.length > 0 && (
          <fieldset>
            <legend>Kosher certification</legend>
            {kosher.map((k) => <label key={k.value} className="facet-option"><input type="checkbox" name="kosher" value={k.value} defaultChecked={query.kosher.includes(k.value)} /> {k.value} <span className="facet-count">({k.count})</span></label>)}
          </fieldset>
        )}
        {delivery.length > 0 && (
          <fieldset>
            <legend>Delivery</legend>
            {delivery.map((d) => <label key={d.value} className="facet-option"><input type="checkbox" name="delivery" value={d.value} defaultChecked={query.delivery.includes(d.value)} /> {DELIVERY_LABELS[d.value]} <span className="facet-count">({d.count})</span></label>)}
          </fieldset>
        )}
        {query.attr.map((a) => <input key={a} type="hidden" name="attr" value={a} />)}
        <Button type="submit">Apply filters</Button>
      </Form>
    </details>
  );
}

/** The sort picker: a GET form too, applying as soon as it changes (a button shows only when scripts are off). */
export function SortForm({ action, query, hidden }: { action: string; query: ListingQuery; hidden: Record<string, string | string[]> }) {
  const submit = useSubmit();
  const current = effectiveSort(query);
  const options = SORTS.filter((s) => s !== "relevance" || query.q);
  return (
    <Form method="get" action={action} className="sort-form" onChange={(e) => submit(e.currentTarget, { preventScrollReset: true })}>
      {Object.entries(hidden).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => <input key={`${k}=${x}`} type="hidden" name={k} value={x} />))}
      <label>Sort by <select name="sort" defaultValue={current}>{options.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}</select></label>
      <noscript><Button type="submit" variant="secondary">Sort</Button></noscript>
    </Form>
  );
}

/** The category facet: the tree as links (choosing one is a navigation, not a filter box). */
export function CategoryLinks({ nodes, hrefFor, current }: { nodes: CategoryNode[]; hrefFor: (slug: string) => string; current?: string | undefined }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="category-links">
      {nodes.map((n) => (
        <li key={n.id}>
          <Link to={hrefFor(n.slug)} aria-current={n.slug === current ? "true" : undefined}>{n.name} <span className="facet-count">({n.listingCount})</span></Link>
          {n.children.length > 0 && <CategoryLinks nodes={n.children} hrefFor={hrefFor} current={current} />}
        </li>
      ))}
    </ul>
  );
}
