import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { ListingCard } from "./ListingCard";
import { ListingsPage } from "./ListingsPage";
import { emptyQuery, type ListingCardData, type ListingPageData, type ListingQuery } from "~/lib/search";

const withRouter = (ui: React.ReactElement, path = "/search") => render(<RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [path] })} />);

const card = (over: Partial<ListingCardData> = {}): ListingCardData => ({
  id: "i1", slug: "classic-braided-challah", type: "product", title: "Classic Braided Challah", summary: "s", priceFromCents: 650, priceToCents: 1250, compareAtFromCents: 750, currency: "USD", available: true, demo: false,
  brand: { slug: "challah-corner", name: "Challah Corner" }, seller: { id: "s", displayName: "Mazel" }, category: { slug: "bakery", name: "Bakery" }, image: { id: "im", width: 1200, height: 1200, alt: "Photo" }, ...over,
});
const data = (over: Partial<ListingPageData> = {}): ListingPageData => ({
  items: [card()], page: 1, pageSize: 24, total: 1, totalPages: 1,
  facets: { categories: [{ id: "c1", slug: "food-drink", name: "Food & Drink", listingCount: 3, children: [{ id: "c2", slug: "bakery", name: "Bakery", listingCount: 2, children: [] }] }],
    brands: [{ slug: "challah-corner", name: "Challah Corner", count: 2 }, { slug: "other", name: "Other", count: 1 }], types: [{ value: "product", count: 2 }, { value: "service", count: 1 }], available: 2,
    price: { minCents: 650, maxCents: 8900 }, attributes: { "kosher-certification": [{ value: "OU", count: 2 }], delivery: [{ value: "ships", count: 2 }, { value: "teleport", count: 1 }] } }, ...over,
});
const q = (over: Partial<ListingQuery> = {}): ListingQuery => ({ ...emptyQuery(), ...over });

describe("ListingCard", () => {
  it("is one link to the product with the brand, title and a price range that screen readers hear in full", () => {
    withRouter(<ul><ListingCard item={card()} /></ul>);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/p/classic-braided-challah");
    expect(link).toHaveTextContent("Challah Corner");
    expect(link).toHaveTextContent("From $6.50");
    expect(link).toHaveTextContent("up to $12.50");
    expect(screen.getByAltText("Photo")).toHaveAttribute("loading", "lazy");
  });
  it("shows one price with its struck-through price, and says so when sold out or a service", () => {
    withRouter(<ul><ListingCard item={card({ priceToCents: 650, available: false, type: "service" })} priority /></ul>);
    expect(screen.getByRole("link")).toHaveTextContent("$6.50");
    expect(screen.getByRole("link")).toHaveTextContent("was $7.50");
    expect(screen.getByText("Sold out")).toBeInTheDocument();                              // text, not only colour
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByAltText("Photo")).toHaveAttribute("fetchpriority", "high");
  });
  it("copes with a listing that has no photo", () => {
    withRouter(<ul><ListingCard item={card({ image: null })} /></ul>);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("ListingsPage", () => {
  it("shows the count as a status, the grid, the category links and the filter form", () => {
    withRouter(<ListingsPage title="Results for “challah”" data={data({ total: 1234 })} query={q({ q: "challah" })} basePath="/search" categories={data().facets!.categories} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Results for “challah”");
    expect(screen.getByRole("heading", { level: 2, name: "1,234 results" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1,234 results");
    expect(screen.getAllByRole("listitem").some((li) => li.className.includes("listing-card"))).toBe(true);
    const nav = screen.getByRole("navigation", { name: "Categories" });
    expect(within(nav).getByRole("link", { name: /Bakery/ })).toHaveAttribute("href", "/search?q=challah&category=bakery");
    expect(screen.getByRole("form", { name: "Filter results" })).toBeInTheDocument();
  });

  it("renders the filters for both layouts, so the page needs no script to lay itself out: a closed menu for phones and a panel for wide screens", () => {
    const { container } = withRouter(<ListingsPage title="T" data={data()} query={q({ available: true })} basePath="/search" />);
    const menu = container.querySelector("details.facets-mobile") as HTMLDetailsElement;
    expect(menu).not.toBeNull();
    expect(menu.open).toBe(false);                                                        // closed in the markup itself, not by a script afterwards
    expect(menu.querySelector("summary")).toHaveTextContent("Filters (active)");
    expect(menu.querySelector("form")).toHaveAttribute("aria-label", "Filter results (menu)");
    const panel = container.querySelector(".facets-desktop") as HTMLElement;
    expect(panel.querySelector("h2")).toHaveTextContent("Filters");
    expect(panel.querySelector("form")).toHaveAttribute("aria-label", "Filter results");
    // both forms carry the same state
    for (const form of [menu.querySelector("form")!, panel.querySelector("form")!]) {
      expect((form.querySelector('input[name="available"]') as HTMLInputElement).checked).toBe(true);
    }
  });

  it("says 'result' for one", () => {
    withRouter(<ListingsPage title="T" data={data({ total: 1 })} query={q()} basePath="/search" />);
    expect(screen.getByRole("status")).toHaveTextContent("1 result");
  });

  it("offers a filter group per facet, hides values it has no label for, and checks what the address says", () => {
    withRouter(<ListingsPage title="T" data={data()} query={q({ kosher: ["OU"], delivery: ["ships"], brand: "other", available: true, priceMin: 650, type: "service" })} basePath="/search" />);
    const form = screen.getByRole("form", { name: "Filter results" });
    expect(within(form).getByRole("checkbox", { name: /OU/ })).toBeChecked();
    expect(within(form).getByRole("checkbox", { name: /Ships to you/ })).toBeChecked();
    expect(within(form).queryByText(/teleport/)).toBeNull();                              // an unknown delivery value is not offered
    expect(within(form).getByRole("radio", { name: /^Other/ })).toBeChecked();
    expect(within(form).getByRole("radio", { name: /Services/ })).toBeChecked();
    expect(within(form).getByRole("checkbox", { name: /In stock only/ })).toBeChecked();
    expect((within(form).getAllByRole("textbox")[0] as HTMLInputElement).value).toBe("6.50");   // the form shows dollars; the address holds cents
    expect(within(form).getByRole("button", { name: "Apply filters" })).toBeInTheDocument();
  });

  it("keeps the search text, sort and category in the filter form as hidden fields", () => {
    const { container } = withRouter(<ListingsPage title="T" data={data()} query={q({ q: "wine", category: "bakery", sort: "title" })} basePath="/search" />);
    const hidden = Array.from(container.querySelectorAll<HTMLInputElement>('.facets-form input[type="hidden"]')).map((i) => `${i.name}=${i.value}`);
    expect(hidden).toEqual(expect.arrayContaining(["q=wine", "sort=title", "category=bakery"]));
  });

  it("lists active filters as links that remove one filter, and 'Clear all'", () => {
    withRouter(<ListingsPage title="T" data={data()} query={q({ q: "a", available: true, kosher: ["OU"], page: 3 })} basePath="/search" />);
    const chips = screen.getByRole("list", { name: "Active filters" });
    expect(within(chips).getByRole("link", { name: /In stock/ })).toHaveAttribute("href", "/search?q=a&kosher=OU");        // restarts at page 1
    expect(within(chips).getByRole("link", { name: /OU/ })).toHaveAttribute("href", "/search?q=a&available=true");
    expect(within(chips).getByRole("link", { name: "Clear all" })).toHaveAttribute("href", "/search?q=a");
  });

  it("on a category page the path says the category: it is not in the address, and the sub-categories link to their own pages", () => {
    withRouter(<ListingsPage title="Food" data={data()} query={q({ category: "food-drink", available: true })} basePath="/c/food-drink" fixed={["category"]} categories={data().facets!.categories[0]!.children} categoriesTitle="In this category" />, "/c/food-drink");
    expect(screen.getByRole("link", { name: /In stock/ })).toHaveAttribute("href", "/c/food-drink");
    expect(screen.getByRole("navigation", { name: "In this category" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "In this category" })).getByRole("link", { name: /Bakery/ })).toHaveAttribute("href", "/c/bakery");
    expect(document.querySelector('.facets-form input[name="category"]')).toBeNull();
  });

  it("paginates with links that keep every filter", () => {
    withRouter(<ListingsPage title="T" data={data({ page: 2, totalPages: 5 })} query={q({ q: "a", available: true, page: 2 })} basePath="/search" />);
    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(nav).getByRole("link", { name: "Next" })).toHaveAttribute("href", "/search?q=a&available=true&page=3");
    expect(within(nav).getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/search?q=a&available=true");
  });

  it("explains an empty result and offers to clear filters only when there are some", () => {
    const { unmount } = withRouter(<ListingsPage title="T" data={data({ items: [], total: 0, facets: null })} query={q({ q: "zzz" })} basePath="/search" />);
    expect(screen.getByText("No listings match")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Clear filters" })).toBeNull();
    unmount();
    withRouter(<ListingsPage title="T" data={data({ items: [], total: 0, facets: null })} query={q({ q: "zzz", available: true })} basePath="/search" />);
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/search?q=zzz");
  });

  it("the sort menu offers best match only for a search and shows the current choice", () => {
    const { unmount } = withRouter(<ListingsPage title="T" data={data()} query={q({ q: "a" })} basePath="/search" />);
    expect((screen.getByRole("combobox", { name: /Sort by/ }) as HTMLSelectElement).value).toBe("relevance");
    unmount();
    withRouter(<ListingsPage title="T" data={data()} query={q({ sort: "price_desc" })} basePath="/search" />);
    const select = screen.getByRole("combobox", { name: /Sort by/ }) as HTMLSelectElement;
    expect(select.value).toBe("price_desc");
    expect(Array.from(select.options).map((o) => o.value)).not.toContain("relevance");
  });
});
