import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import Home from "./home";
import type { ListingCardData } from "~/lib/search";

const card = (id: string, title: string): ListingCardData => ({
  id, slug: id, type: "product", title, summary: "s", priceFromCents: 650, priceToCents: 650, compareAtFromCents: null, currency: "USD", available: true,
  brand: { slug: "b", name: "Brand" }, seller: { id: "s", displayName: "Mazel" }, category: { slug: "bakery", name: "Bakery" }, image: null,
} as unknown as ListingCardData);
const show = (data: { featured: ListingCardData[]; unavailable: boolean }) => {
  const props = { loaderData: { origin: "https://x.test", ...data } } as unknown as Parameters<typeof Home>[0];
  render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <Home {...props} /> }])} />);
};

describe("home: Featured (issue #2)", () => {
  it("shows the listings the catalog returned, not the placeholder", () => {
    show({ featured: [card("a", "Challah"), card("b", "Candlesticks")], unavailable: false });
    expect(screen.getByRole("list", { name: "Featured listings" })).toBeInTheDocument();
    expect(screen.getByText("Challah")).toBeInTheDocument();
    expect(screen.queryByText(/on their way/i)).toBeNull();
    expect(screen.queryByText("No listings yet")).toBeNull();
  });
  it("says the catalog is empty only when it really is", () => {
    show({ featured: [], unavailable: false });
    expect(screen.getByText("No listings yet")).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
  });
  it("says so when the catalog could not be reached, instead of claiming it is empty", () => {
    show({ featured: [], unavailable: true });
    expect(screen.getByText("Listings could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("No listings yet")).toBeNull();
  });
});
