import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { orderStatusText } from "~/lib/checkout";
import type { CheckoutOrder } from "~/lib/api-client.server";
import { OrderConfirmation } from "./OrderConfirmation";

const order = (over: Partial<CheckoutOrder> = {}): CheckoutOrder => ({ number: "MP-1", status: "failed", currency: "USD", totalCents: 1800, createdAt: "2026-11-19T00:00:00Z", ...over });
const show = (o: CheckoutOrder) => render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <OrderConfirmation order={o} lost={false} /> }])} />);

describe("failed order after a quantity offer mismatch", () => {
  it("says the offer changed and the payment is refunded in full", () => {
    show(order({ failureCode: "offer_mismatch" }));
    expect(screen.getByRole("heading", { name: "We couldn't place your order" })).toBeInTheDocument();
    expect(screen.getByTestId("order-status")).toHaveTextContent("quantity offer");
    expect(screen.getByTestId("order-status")).toHaveTextContent("refunded in full");
    expect(screen.getByRole("link", { name: "Back to your cart" })).toBeInTheDocument();
  });
  it("keeps the generic failed wording for any other failure code", () => {
    show(order({ failureCode: "invalid_order" }));
    expect(screen.getByTestId("order-status")).not.toHaveTextContent("quantity offer");
    expect(screen.getByTestId("order-status")).toHaveTextContent("You have not been charged");
  });
  it("only uses the offer wording for a failed order", () => {
    expect(orderStatusText({ status: "placed", failureCode: "offer_mismatch" }).title).toContain("order is placed");
  });
});
