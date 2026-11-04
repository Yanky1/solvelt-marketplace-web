import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { Breadcrumb, Pagination, Price, RatingStars } from "./display";
import { Checkbox, Input } from "./form";

const withRouter = (ui: React.ReactElement) => render(<RouterProvider router={createMemoryRouter([{ path: "*", element: ui }])} />);

describe("Input", () => {
  it("links label, hint and error to the control", () => {
    render(<Input label="Email" hint="Never shared" error="Required" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Never shared Required");
  });
  it("has no error attributes when valid", () => {
    render(<Input label="Name" />);
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });
});

describe("Checkbox", () => { it("is labelled", () => { render(<Checkbox label="Remember me" />); expect(screen.getByRole("checkbox", { name: "Remember me" })).toBeInTheDocument(); }); });

describe("Price", () => {
  it("formats cents and announces the old price", () => {
    render(<Price cents={4999} wasCents={5999} />);
    expect(screen.getByText("$49.99")).toBeInTheDocument();
    expect(screen.getByText("$59.99")).toBeInTheDocument();
    expect(screen.getByText("was", { exact: false })).toHaveClass("sr-only");
  });
  it("ignores a was-price that is not higher", () => {
    render(<Price cents={4999} wasCents={4999} />);
    expect(screen.queryByText("was", { exact: false })).toBeNull();
  });
});

describe("RatingStars", () => {
  it("exposes the value as text", () => { render(<RatingStars value={4.4} count={12} />); expect(screen.getByText("Rated 4.4 out of 5")).toBeInTheDocument(); });
  it("clamps out-of-range values", () => { render(<RatingStars value={9} />); expect(screen.getByText("Rated 5.0 out of 5")).toBeInTheDocument(); });
});

describe("Breadcrumb", () => {
  it("marks the last item as the current page and links earlier ones", () => {
    withRouter(<Breadcrumb items={[{ label: "Home", to: "/" }, { label: "Shoes", to: "/c/shoes" }, { label: "Boots" }]} />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Boots")).toHaveAttribute("aria-current", "page");
  });
});

describe("Pagination", () => {
  it("renders nothing for a single page", () => { const { container } = withRouter(<Pagination page={1} pageCount={1} hrefFor={(p) => `?p=${p}`} />); expect(container.querySelector("nav")).toBeNull(); });
  it("marks the current page and offers prev/next", () => {
    withRouter(<Pagination page={3} pageCount={6} hrefFor={(p) => `?p=${p}`} />);
    expect(screen.getByText("3")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/?p=2");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/?p=4");
  });
});
