import { describe, expect, it } from "vitest";
import type { NotificationItem } from "./api-client.server";
import { CATEGORY_KEYS, REQUIRED_CATEGORIES, notificationLink, notificationText } from "./notifications";

const n = (over: Partial<NotificationItem>): NotificationItem => ({ id: "n1", kind: "order_shipped", category: "shipped", orderNumber: "MP-1", sellerOrderNumber: null, parameters: { sellerName: "Challah Corner" }, createdAt: "2026-11-04T10:00:00Z", read: false, ...over });

describe("notification text and links", () => {
  it("says what happened from the kind and the non-personal parameters", () => {
    expect(notificationText(n({ parameters: { sellerName: "Challah Corner", carrier: "USPS" } }))).toBe("Challah Corner shipped order MP-1 with USPS.");
    expect(notificationText(n({ kind: "refund_issued", parameters: { sellerName: "Bakery", amountCents: 1234 } }))).toBe("Bakery refunded $12.34 for order MP-1.");
    expect(notificationText(n({ kind: "out_for_delivery" }))).toBe("Order MP-1 is out for delivery.");
    expect(notificationText(n({ kind: "message_received", parameters: { sellerName: "Bakery", subject: "Order MP-1" } }))).toBe("Bakery sent you a message about Order MP-1.");
    expect(notificationText(n({ kind: "booking_confirmed", orderNumber: null, parameters: { bookingNumber: "B-7" } }))).toBe("There is an update on your booking B-7.");
  });

  it("never fails on an unknown kind or odd parameters (a newer API than this page)", () => {
    expect(notificationText(n({ kind: "something_new" }))).toBe("There is an update on your account.");
    expect(notificationText(n({ parameters: null }))).toBe("the seller shipped order MP-1.");
    expect(notificationText(n({ parameters: { sellerName: 5, carrier: { x: 1 } } as never }))).toBe("the seller shipped order MP-1.");
  });

  it("links only to our own account pages and only with safe ids", () => {
    expect(notificationLink(n({}))).toBe("/account/orders/MP-1");
    expect(notificationLink(n({ orderNumber: "../../evil" }))).toBeNull();
    expect(notificationLink(n({ orderNumber: null }))).toBeNull();
    expect(notificationLink(n({ kind: "message_received", parameters: { threadId: "abc-123" } }))).toBe("/account/messages/abc-123");
    expect(notificationLink(n({ kind: "message_received", parameters: { threadId: "//evil.example" } }))).toBe("/account/messages");
    expect(notificationLink(n({ kind: "booking_cancelled" }))).toBe("/account/bookings");
  });

  it("lists the six switchable email categories of the API (refunds, cancellations and failed deliveries are always emailed)", () => {
    expect(CATEGORY_KEYS).toEqual(["order_updates", "shipped", "out_for_delivery", "delivered", "messages", "bookings"]);
    expect(REQUIRED_CATEGORIES.map((c) => c.key)).toEqual(["refunds", "cancellations", "delivery_problems", "returns", "booking_changes"]);
    expect(CATEGORY_KEYS.filter((k) => REQUIRED_CATEGORIES.some((r) => r.key === k))).toEqual([]);   // a save can never carry a required category
  });
});
