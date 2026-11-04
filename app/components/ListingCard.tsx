import { Link } from "react-router";
import { Img } from "./Img";
import { Badge, Price, formatMoney } from "./ui/display";
import type { ListingCardData } from "~/lib/search";
import { listingPath } from "~/lib/urls";

/** One listing in a grid: the whole card is one link (one tab stop), with the price and stock state as text, not colour. */
export function ListingCard({ item, priority = false }: { item: ListingCardData; priority?: boolean }) {
  const range = item.priceToCents > item.priceFromCents;
  return (
    <li className="listing-card">
      <Link to={listingPath(item.slug)} className="listing-card-link">
        <div className="listing-card-media">
          {item.image ? (
            <Img imageId={item.image.id} width={item.image.width} height={item.image.height} alt={item.image.alt} sizes="(min-width: 1100px) 25vw, (min-width: 700px) 33vw, 50vw" priority={priority} />
          ) : (
            <span className="listing-card-noimage" aria-hidden="true" />
          )}
          {!item.available && <span className="listing-card-flag"><Badge tone="neutral">Sold out</Badge></span>}
        </div>
        <span className="listing-card-brand">{item.brand.name}</span>
        <span className="listing-card-title">{item.title}</span>
        <span className="listing-card-price">
          {range ? <><span className="listing-card-from">From </span><Price cents={item.priceFromCents} currency={item.currency} /></> : <Price cents={item.priceFromCents} wasCents={item.compareAtFromCents ?? undefined} currency={item.currency} />}
          {range && <span className="sr-only">, up to {formatMoney(item.priceToCents, item.currency)}</span>}
        </span>
        {item.type === "service" && <span className="listing-card-kind">Service</span>}
      </Link>
    </li>
  );
}
