import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import Cart from "~/routes/cart";
import type { Cart as CartData, QuoteGroup } from "~/lib/api-client.server";
import { priceChangedMessage, type CartOffer, type ListingOffer } from "~/lib/offers";
import { CartGroupOffers, ListingOfferBadges, QuoteGroupLines, QuoteSavingsRow } from "./OfferUi";

const show = (ui: React.ReactElement) => render(<RouterProvider router={createMemoryRouter([{ path: "*", element: ui }])} />);

const listingOffer: ListingOffer = { offerId: "o1", name: "Bundle", tiers: [{ minQuantity: 20, unitPriceCents: 90 }], gifts: [{ minQuantity: 10, productId: "g1", title: "Wallet", quantity: 1, available: true }] };

describe("listing badge", () => {
  it("says what to buy and what it costs, in text", () => {
    show(<ListingOfferBadges offers={[listingOffer]} currency="USD" />);
    const list = screen.getByRole("list", { name: "Quantity offers" });
    expect(within(list).getByText("Buy 20+, $0.90 each")).toBeInTheDocument();
    expect(within(list).getByText("Free Wallet from 10")).toBeInTheDocument();
  });
  it("renders nothing without offers", () => {
    show(<ListingOfferBadges offers={undefined} currency="USD" />);
    expect(screen.queryByTestId("offer-badges")).toBeNull();
  });
});

const offer = (over: Partial<CartOffer> = {}): CartOffer => ({ offerId: "o1", eligibleUnits: 15, tier: null, nextTier: { minQuantity: 20, unitPriceCents: 90 }, unitsToNextTier: 5, discountCents: 0, gifts: [], ...over });
const gift = (status: "included" | "unavailable") => ({ productId: "g", title: "Wallet", quantity: 1, status });

describe("cart group messages", () => {
  it("asks for the units the server says are missing", () => {
    show(<CartGroupOffers offers={[offer()]} currency="USD" />);
    expect(screen.getByText("Add 5 more for $0.90 each")).toBeInTheDocument();
    expect(screen.queryByText(/Free gift included/)).toBeNull();
  });
  it("says a gift is included", () => {
    show(<CartGroupOffers offers={[offer({ nextTier: null, unitsToNextTier: 0, gifts: [gift("included")] })]} currency="USD" />);
    expect(screen.getByText("Free gift included: Wallet")).toBeInTheDocument();
  });
  it("says a gift is unavailable", () => {
    show(<CartGroupOffers offers={[offer({ nextTier: null, unitsToNextTier: 0, gifts: [gift("unavailable")] })]} currency="USD" />);
    expect(screen.getByText("Gift unavailable: Wallet")).toBeInTheDocument();
    expect(screen.queryByText(/Free gift included/)).toBeNull();
  });
  it("shows nothing for a group without offers", () => {
    show(<CartGroupOffers offers={undefined} currency="USD" />);
    expect(screen.queryByTestId("cart-offer")).toBeNull();
  });
});

const cart = (): CartData => ({
  currency: "USD", itemCount: 20, subtotalCents: 1800, canCheckout: true,
  groups: [{
    sellerId: "s", sellerName: "Blitz", brandId: "b", brandName: "Blitz Cards", subtotalCents: 1800, discountCents: 200, offers: [offer({ eligibleUnits: 20, tier: { minQuantity: 20, unitPriceCents: 90 }, nextTier: null, unitsToNextTier: 0, discountCents: 200, gifts: [gift("included")] })],
    lines: [{ id: "l1", listingId: "p1", variantId: "v1", slug: "cards", title: "Cards", variantName: "Blue", imageId: null, quantity: 20, unitPriceCents: 100, compareAtCents: null, lineTotalCents: 1800, status: "ok", previousUnitPriceCents: null, discountCents: 200, offerId: "o1" }],
  }],
});
const showCart = (c: CartData) => {
  const props = { loaderData: { cart: c, notice: null } } as unknown as Parameters<typeof Cart>[0];
  render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <Cart {...props} /> }])} />);
};

describe("cart page", () => {
  it("shows the offer discount on the line, the group message, and the net line total", () => {
    showCart(cart());
    expect(screen.getByTestId("cart-line-discount")).toHaveTextContent("Quantity offer: $2.00 off");
    expect(screen.getByTestId("cart-offer")).toHaveTextContent("Free gift included: Wallet");
    expect(screen.getByTestId("cart-line")).toHaveTextContent("$18.00");
  });
  it("shows no discount line when there is none", () => {
    const c = cart(); c.groups[0]!.lines[0]!.discountCents = 0;
    showCart(c);
    expect(screen.queryByTestId("cart-line-discount")).toBeNull();
  });
});

const group = (over: Partial<QuoteGroup> = {}): QuoteGroup => ({
  sellerId: "s", sellerName: "Blitz", brandId: "b", brandName: "Blitz Cards", itemsCents: 1800, shippingOptions: [], unavailableSpeeds: [], local: null, selected: null, shippingCents: 0, shippingTaxCents: 0, taxCents: 0, totalCents: 1800,
  lines: [{ lineId: "l1", listingId: "p1", variantId: "v1", title: "Cards", variantName: "Blue", quantity: 20, unitPriceCents: 100, lineTotalCents: 1800, taxCents: 0, discountCents: 200 }],
  giftLines: [{ productId: "g", title: "Card wallet", quantity: 1, unitPriceCents: 0 }], ...over,
});

describe("checkout lines", () => {
  it("shows the discount, and the gift at $0", () => {
    show(<QuoteGroupLines group={group()} currency="USD" />);
    expect(screen.getByTestId("checkout-line-discount")).toHaveTextContent("quantity offer: $2.00 off");
    expect(screen.getByTestId("checkout-gift-line")).toHaveTextContent("Card wallet × 1");
    expect(screen.getByTestId("checkout-gift-line")).toHaveTextContent("Free gift: $0.00");
  });
  it("says the order goes through without an unavailable gift", () => {
    show(<QuoteGroupLines group={group({ giftLines: [], offers: [offer({ nextTier: null, unitsToNextTier: 0, gifts: [gift("unavailable")] })] })} currency="USD" />);
    expect(screen.getByTestId("checkout-gift-unavailable")).toHaveTextContent("Gift unavailable: Wallet. Your order goes through without it.");
    expect(screen.queryByTestId("checkout-gift-line")).toBeNull();
  });
  it("has no discount text for an ordinary line", () => {
    const g = group({ giftLines: [] }); g.lines[0]!.discountCents = 0;
    show(<QuoteGroupLines group={g} currency="USD" />);
    expect(screen.queryByTestId("checkout-line-discount")).toBeNull();
  });
});

describe("checkout savings row", () => {
  it("shows the savings only when an offer discounted the order", () => {
    const { unmount } = render(<dl><QuoteSavingsRow discountCents={200} currency="USD" /></dl>);
    expect(screen.getByTestId("checkout-discount")).toHaveTextContent("$2.00");
    unmount();
    render(<dl><QuoteSavingsRow discountCents={0} currency="USD" /></dl>);
    expect(screen.queryByTestId("checkout-discount")).toBeNull();
  });
});

describe("409 price_changed notice", () => {
  it("names the offer and says nothing was charged when the API says offer_changed", () => {
    const m = priceChangedMessage({ messageCode: "offer_changed", quote: {} });
    expect(m).toContain("quantity offer");
    expect(m).toContain("Nothing was charged");
  });
  it("keeps the usual wording for any other cause", () => {
    expect(priceChangedMessage({ quote: {} })).toBe("The price or delivery changed while you were checking out. Please review the new total and pay again.");
    expect(priceChangedMessage(undefined)).toContain("price or delivery");
  });
});
