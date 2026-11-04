import { redirect, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/product";
import { AddToCart } from "~/components/AddToCart";
import { Gallery } from "~/components/Gallery";
import { JsonLd } from "~/components/JsonLd";
import { VariantPicker } from "~/components/VariantPicker";
import { Badge, Breadcrumb, Price } from "~/components/ui/display";
import { Link, useSearchParams } from "react-router";
import { apiCtx } from "~/lib/auth.server";
import { attributeLabel, attributeValues, deliveryLabels, pickVariant, specAttributes, type ListingDetail } from "~/lib/catalog";
import { catalog, catalogErrorResponse, GUID } from "~/lib/catalog.server";
import { getConfig } from "~/lib/config.server";
import { breadcrumbJsonLd, clipText, imageUrl, listingJsonLd, priceString } from "~/lib/seo";
import { brandPath, categoryPath, listingPath, sellerPath } from "~/lib/urls";

/**
 * Product and service page (/p/:slug). Public catalog data only: the API call carries no session token, so nothing about the visitor can reach the page or
 * a log. The document is `private, no-cache` like every HTML page (decision W2-01: the shell reads the visitor cookie, so it is not shareable).
 */
const noStore = { "Cache-Control": "no-store" };

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const slug = params.slug ?? "";
  let result;
  try {
    result = await catalog.listing(apiCtx(request, context, null), slug);
  } catch (e) {
    throw catalogErrorResponse(e);
  }
  if (result.kind === "gone") throw new Response("Gone", { status: 410, headers: noStore });
  if (result.kind === "notFound") throw new Response("Not found", { status: 404, headers: noStore });
  const { listing } = result;
  // An id URL (or any other spelling) goes to the one canonical address.
  if (slug !== listing.slug) {
    const url = new URL(request.url);
    throw redirect(listingPath(listing.slug) + url.search, { status: GUID.test(slug) ? 301 : 302 });
  }
  const origin = getConfig().publicOrigin;
  return { listing, origin };
}

/** Choosing a variant only changes the query string: the listing is already here, so do not ask the API again. */
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (currentUrl.pathname === nextUrl.pathname) {
    const a = new URLSearchParams(currentUrl.search), b = new URLSearchParams(nextUrl.search);
    a.delete("variant"); b.delete("variant");
    if (a.toString() === b.toString()) return false;
  }
  return defaultShouldRevalidate;
}

export function meta({ data: d }: Route.MetaArgs) {
  if (!d) return [{ title: "Not found | Solvelt" }, { name: "robots", content: "noindex" }];
  const { listing, origin } = d;
  const url = origin + listingPath(listing.slug);
  const title = `${clipText(listing.title, 60)} | Solvelt`;
  const description = clipText(listing.summary || listing.description);
  const main = listing.images[0];
  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: "product" },
    { property: "og:site_name", content: "Solvelt Market" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    ...(main ? [{ property: "og:image", content: imageUrl(origin, main.id) }, { property: "og:image:alt", content: main.alt }] : []),
    { property: "product:price:amount", content: priceString(listing.priceFromCents) },
    { property: "product:price:currency", content: listing.currency },
    { name: "twitter:card", content: main ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
}

function Paragraphs({ text }: { text: string }) {
  return <>{text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}</>;
}

function KosherBadges({ listing }: { listing: ListingDetail }) {
  const cert = attributeValues(listing, "kosher-certification");
  const status = attributeValues(listing, "kosher-status");
  const passover = attributeValues(listing, "kosher-for-passover").includes("yes");
  if (!cert.length && !status.length && !passover) return null;
  return (
    <ul className="chips" aria-label="Kosher information">
      {cert.map((c) => <li key={c}><Badge tone="gold">Kosher: {c}</Badge></li>)}
      {status.map((s) => <li key={s}><Badge>{s[0]?.toUpperCase() + s.slice(1)}</Badge></li>)}
      {passover && <li><Badge tone="ok">Kosher for Passover</Badge></li>}
    </ul>
  );
}

export default function ProductPage({ loaderData }: Route.ComponentProps) {
  const { listing, origin } = loaderData;
  // The choice lives in the address, not in loader data: choosing an option does not reload the listing (shouldRevalidate), so only the address changes.
  const [params] = useSearchParams();
  const variant = pickVariant(listing, params.get("variant"));
  const crumbs = [{ label: "Home", to: "/" }, ...listing.categoryPath.map((c) => ({ label: c.name, to: categoryPath(c.slug) })), { label: listing.title }];
  const delivery = deliveryLabels(listing);
  const specs = specAttributes(listing).filter((a) => !a.key.startsWith("kosher-"));
  const isService = listing.type === "service";
  return (
    <article className="pdp stack">
      <Breadcrumb items={crumbs} />
      <div className="pdp-grid">
        <Gallery images={listing.images} title={listing.title} />
        <div className="pdp-buy stack">
          <div>
            <p className="muted pdp-brand"><Link to={brandPath(listing.brand.slug)}>{listing.brand.name}</Link>{" · "}Sold by <Link to={sellerPath(listing.seller.id)}>{listing.seller.displayName}</Link></p>
            <h1>{listing.title}</h1>
            {listing.summary && <p className="lead">{listing.summary}</p>}
          </div>
          <KosherBadges listing={listing} />
          <div className="pdp-price" aria-live="polite">
            <Price cents={variant.priceCents} wasCents={variant.compareAtCents ?? undefined} currency={listing.currency} />
            {listing.variants.length > 1 && <span className="muted"> for {variant.name}</span>}
            <p className={variant.available ? "stock stock-in" : "stock stock-out"}>{variant.available ? (isService ? "Available to book" : "In stock") : "Sold out"}</p>
          </div>
          <VariantPicker variants={listing.variants} selectedId={variant.id} currency={listing.currency} />
          {delivery.length > 0 && (
            <ul className="chips" aria-label={isService ? "How this service is offered" : "Delivery options"}>
              {delivery.map((d) => <li key={d}><Badge>{d}</Badge></li>)}
            </ul>
          )}
          {isService
            ? <div className="add-to-cart" data-testid="booking-slot"><p className="muted">Online booking opens soon.</p></div>
            : variant.available
              ? <AddToCart listingId={listing.id} variantId={variant.id} title={listing.title} variantName={variant.name} priceCents={variant.priceCents} currency={listing.currency} />
              : <p className="muted">This option is sold out. {listing.variants.some((v) => v.available) ? "Choose another option." : "Please check back later."}</p>}
        </div>
      </div>
      <section aria-labelledby="about" className="pdp-section stack">
        <h2 id="about">About this {isService ? "service" : "item"}</h2>
        <Paragraphs text={listing.description} />
      </section>
      {specs.length > 0 && (
        <section aria-labelledby="details" className="pdp-section">
          <h2 id="details">Details</h2>
          <dl className="specs">
            {specs.map((a, i) => <div key={i} className="spec"><dt>{attributeLabel(a.key)}</dt><dd>{a.value}</dd></div>)}
          </dl>
        </section>
      )}
      {listing.faqs.length > 0 && (
        <section aria-labelledby="faq" className="pdp-section">
          <h2 id="faq">Questions and answers</h2>
          {listing.faqs.map((f, i) => (
            <details key={i} className="faq">
              <summary>{f.question}</summary>
              <div><Paragraphs text={f.answer} /></div>
            </details>
          ))}
        </section>
      )}
      <JsonLd data={listingJsonLd(listing, origin)} />
      <JsonLd data={breadcrumbJsonLd(origin, [{ name: "Home", path: "/" }, ...listing.categoryPath.map((c) => ({ name: c.name, path: categoryPath(c.slug) })), { name: listing.title, path: listingPath(listing.slug) }])} />
    </article>
  );
}
