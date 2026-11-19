import { Badge, formatMoney } from "~/components/ui/display";
import type { QuoteGroup } from "~/lib/api-client.server";
import { cartOfferMessages, listingOfferBadges, money, type CartOffer, type ListingOffer } from "~/lib/offers";

/** Offer badges on a listing: "Buy 20+, $0.90 each", "Free gift with 10+". Text in a badge, never colour alone. Renders nothing without offers. */
export function ListingOfferBadges({ offers, currency }: { offers: ListingOffer[] | undefined; currency: string }) {
  const badges = listingOfferBadges(offers, currency);
  if (badges.length === 0) return null;
  return (
    <ul className="chips" aria-label="Quantity offers" data-testid="offer-badges">
      {badges.map((b) => <li key={b}><Badge tone="ok">{b}</Badge></li>)}
    </ul>
  );
}

/** What the server's offers say about one cart group: add N more, free gift included, gift unavailable. */
export function CartGroupOffers({ offers, currency }: { offers: CartOffer[] | undefined; currency: string }) {
  return (
    <>
      {(offers ?? []).map((o) => {
        const msgs = cartOfferMessages(o, currency);
        return msgs.length === 0 ? null : (
          <ul key={o.offerId} className="stack u-list-style-none-padding-0-margin-0" aria-label="Quantity offer" data-testid="cart-offer">
            {msgs.map((m) => <li key={m.kind}><Badge tone={m.kind === "gift_unavailable" ? "gold" : "ok"}>{m.text}</Badge></li>)}
          </ul>
        );
      })}
    </>
  );
}

/** The lines of one checkout group as the server priced them: net line totals, the offer discount, $0 gift lines, and the gift-unavailable note. */
export function QuoteGroupLines({ group, currency }: { group: QuoteGroup; currency: string }) {
  return (
    <>
      <ul className="stack u-list-style-none-padding-0-margin-0" data-testid="checkout-lines" aria-label="Items from this seller">
        {group.lines.map((l) => (
          <li key={l.lineId} className="row u-justify-content-space-between" data-testid="checkout-line">
            <span>{l.title}{l.variantName ? `, ${l.variantName}` : ""} × {l.quantity}</span>
            <span>
              {formatMoney(l.lineTotalCents, currency)}
              {(l.discountCents ?? 0) > 0 && <span className="muted" data-testid="checkout-line-discount"> (quantity offer: {money(l.discountCents ?? 0, currency)} off)</span>}
            </span>
          </li>
        ))}
        {(group.giftLines ?? []).map((gl) => (
          <li key={gl.productId} className="row u-justify-content-space-between" data-testid="checkout-gift-line">
            <span>{gl.title} × {gl.quantity}</span>
            <span>Free gift: {formatMoney(0, currency)}</span>
          </li>
        ))}
      </ul>
      {(group.offers ?? []).flatMap((o) => cartOfferMessages(o, currency).filter((m) => m.kind === "gift_unavailable").map((m) => (
        <p key={`${o.offerId}:${m.kind}`} role="status" className="muted u-margin-0" data-testid="checkout-gift-unavailable">{m.text}. Your order goes through without it.</p>
      )))}
    </>
  );
}

/** The savings row of the checkout totals; nothing when no offer discounted the order. */
export function QuoteSavingsRow({ discountCents, currency }: { discountCents: number | undefined; currency: string }) {
  if ((discountCents ?? 0) <= 0) return null;
  return <div className="row u-justify-content-space-between u-margin-0" data-testid="checkout-discount"><dt>Quantity offer savings (already taken off)</dt><dd>{formatMoney(discountCents ?? 0, currency)}</dd></div>;
}
