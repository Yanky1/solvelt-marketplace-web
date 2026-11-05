import { Link } from "react-router";
import { Img } from "./Img";
import { Badge, Price } from "./ui/display";
import type { ListCardView } from "~/lib/lists";
import { listingPath } from "~/lib/urls";

/** A plain grid of the small cards wishlists and "recently viewed" use (catalog data only; the whole card is one link). */
export function ListingGrid({ items, label }: { items: ListCardView[]; label: string }) {
  return (
    <ul className="grid" style={{ listStyle: "none", padding: 0 }} aria-label={label}>
      {items.map((c) => (
        <li key={c.id} className="listing-card">
          <Link to={listingPath(c.slug)} className="listing-card-link">
            <div className="listing-card-media">
              {c.image ? <Img imageId={c.image.id} width={c.image.width} height={c.image.height} alt={c.image.alt} sizes="(min-width: 1100px) 20vw, (min-width: 700px) 25vw, 50vw" /> : <span className="listing-card-noimage" aria-hidden="true" />}
              {!c.available && <span className="listing-card-flag"><Badge tone="neutral">Sold out</Badge></span>}
            </div>
            {c.brandName && <span className="listing-card-brand">{c.brandName}</span>}
            <span className="listing-card-title">{c.title}</span>
            <span className="listing-card-price"><Price cents={c.priceFromCents} currency={c.currency} /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
