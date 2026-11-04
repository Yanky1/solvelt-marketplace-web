import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { Gallery } from "./Gallery";
import { IMAGE_WIDTHS, Img, srcsetWidths } from "./Img";
import { VariantPicker } from "./VariantPicker";
import { AddToCart, CART_ACTION } from "./AddToCart";
import { JsonLd } from "./JsonLd";

const withRouter = (ui: React.ReactElement, path = "/") => render(<RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [path] })} />);

describe("srcsetWidths", () => {
  it("offers the steps up to the natural width and never an upscaled file", () => {
    expect(srcsetWidths(1200)).toEqual([160, 320, 480, 640, 800, 1200]);
    expect(srcsetWidths(1199)).toEqual([160, 320, 480, 640, 800]);
    expect(srcsetWidths(1600)).toEqual([...IMAGE_WIDTHS]);
    expect(srcsetWidths(5000)).toEqual([...IMAGE_WIDTHS]);
    expect(srcsetWidths(100)).toEqual([160]);
  });
});

describe("Img", () => {
  it("has its natural size, a srcset and is lazy by default", () => {
    render(<Img imageId="abc" width={1200} height={900} alt="A cup" sizes="100vw" />);
    const img = screen.getByAltText("A cup");
    expect(img).toHaveAttribute("width", "1200");
    expect(img).toHaveAttribute("height", "900");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).not.toHaveAttribute("fetchpriority");
    expect(img.getAttribute("srcset")).toContain("/img/abc?w=800&h=600 800w");
  });
  it("loads the priority image eagerly with high fetch priority", () => {
    render(<Img imageId="abc" width={1200} height={1200} alt="Hero" sizes="100vw" priority />);
    const img = screen.getByAltText("Hero");
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("fetchpriority", "high");
  });
  it("encodes the id so it cannot change the path", () => {
    render(<Img imageId="a/../b?x" width={320} height={320} alt="x" sizes="100vw" />);
    expect(screen.getByAltText("x").getAttribute("src")).toContain("/img/a%2F..%2Fb%3Fx?");
  });
});

const variants = [
  { id: "v1", name: "Small", priceCents: 650, compareAtCents: 750, available: true },
  { id: "v2", name: "Large", priceCents: 950, compareAtCents: null, available: true },
  { id: "v3", name: "Huge", priceCents: 1250, compareAtCents: null, available: false },
];

describe("VariantPicker", () => {
  it("is a labelled radio group with the selected variant checked and sold-out ones disabled", () => {
    withRouter(<VariantPicker variants={variants} selectedId="v2" currency="USD" />);
    const group = screen.getByRole("group", { name: "Choose an option" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([false, true, false]);
    expect(screen.getByRole("radio", { name: /Huge/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Small/ })).toBeEnabled();
    expect(screen.getByText("Sold out")).toBeInTheDocument();
  });
  it("shows each variant's price and the old price of a reduced one", () => {
    withRouter(<VariantPicker variants={variants} selectedId="v1" currency="USD" />);
    expect(screen.getByText("$6.50")).toBeInTheDocument();
    expect(screen.getByText("$7.50")).toBeInTheDocument();
    expect(screen.getByText("$9.50")).toBeInTheDocument();
  });
  it("is not shown for a single variant", () => {
    const { container } = withRouter(<VariantPicker variants={[variants[0]!]} selectedId="v1" currency="USD" />);
    expect(container.querySelector("fieldset")).toBeNull();
  });
  it("keeps a sold-out variant selectable when it is the one in the address (so the page can say it is sold out)", () => {
    withRouter(<VariantPicker variants={variants} selectedId="v3" currency="USD" />);
    expect(screen.getByRole("radio", { name: /Huge/ })).toBeEnabled();
  });
  it("changes the address (replacing history) when another option is chosen", async () => {
    const router = createMemoryRouter([{ path: "/p/x", element: <VariantPicker variants={variants} selectedId="v1" currency="USD" /> }], { initialEntries: ["/p/x"] });
    render(<RouterProvider router={router} />);
    await userEvent.click(screen.getByRole("radio", { name: /Large/ }));
    await Promise.resolve();
    expect(router.state.location.search).toBe("?variant=v2");
    expect(router.state.historyAction).toBe("REPLACE");
  });
});

describe("AddToCart slot", () => {
  const props = { listingId: "l1", variantId: "v1", title: "Challah", variantName: "Small", priceCents: 650, currency: "USD" };
  it("is a disabled, explained button until the cart action exists", () => {
    withRouter(<AddToCart {...props} />);
    const button = screen.getByRole("button", { name: "Add to cart" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/cart opens soon/i);
    expect(screen.getByTestId("add-to-cart-slot").querySelector("form")).toBeNull();     // no form that goes nowhere
  });
  it("is the contract form once the cart is ready: listingId, variantId, qty, csrf, posted to the cart action", () => {
    const was = { ...CART_ACTION };
    CART_ACTION.ready = true; CART_ACTION.action = "/cart/items";
    try {
      withRouter(<AddToCart {...props} />);
      const form = screen.getByTestId("add-to-cart-slot") as HTMLFormElement;
      expect(form.getAttribute("method")).toBe("post");
      expect(form.getAttribute("action")).toBe("/cart/items");
      expect(Array.from(form.querySelectorAll("input")).map((i) => i.name).sort()).toEqual(["csrf", "listingId", "qty", "variantId"]);
      expect((form.querySelector("[name=listingId]") as HTMLInputElement).value).toBe("l1");
      expect((form.querySelector("[name=variantId]") as HTMLInputElement).value).toBe("v1");
      expect((form.querySelector("[name=qty]") as HTMLInputElement).min).toBe("1");
      expect(screen.getByRole("button", { name: "Add Challah, Small, to cart" })).toBeEnabled();
    } finally { Object.assign(CART_ACTION, was); }
  });
});

describe("Gallery", () => {
  const images = [{ id: "i1", width: 1200, height: 1200, alt: "front" }, { id: "i2", width: 1600, height: 1200, alt: "side" }, { id: "i3", width: 1600, height: 1200, alt: "back" }];
  it("shows the first photo eagerly and thumbnails to switch", async () => {
    render(<Gallery images={images} title="Cup" />);
    expect(screen.getByAltText("front")).toHaveAttribute("fetchpriority", "high");
    expect(screen.getByRole("button", { name: "Show photo 1 of 3" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Show photo 2 of 3" }));
    expect(screen.getByAltText("side")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show photo 2 of 3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Show photo 1 of 3" })).toHaveAttribute("aria-pressed", "false");
  });
  it("has no thumbnails for one photo and a plain note for none", () => {
    const { unmount } = render(<Gallery images={[images[0]!]} title="Cup" />);
    expect(screen.queryByRole("list", { name: "Photos" })).toBeNull();
    unmount();
    render(<Gallery images={[]} title="Cup" />);
    expect(screen.getByRole("img", { name: "No photo yet for Cup" })).toBeInTheDocument();
  });
  it("opens the large photo in a dialog from the main picture", async () => {
    render(<Gallery images={images} title="Cup" />);
    await userEvent.click(screen.getByRole("button", { name: "Zoom photo 1 of 3" }));
    const big = document.querySelector("img.gallery-zoom") as HTMLImageElement;
    expect(big.getAttribute("src")).toContain("/img/i1?w=1600&h=1600");
  });
});

describe("JsonLd", () => {
  it("renders a data block whose text cannot leave the tag", () => {
    const { container } = render(<JsonLd data={{ name: "</script><img src=x onerror=alert(1)>" }} />);
    const s = container.querySelector('script[type="application/ld+json"]')!;
    expect(s.innerHTML).not.toContain("</script>");
    expect(JSON.parse(s.textContent!).name).toContain("onerror");
    expect(container.querySelector("img")).toBeNull();
  });
});
