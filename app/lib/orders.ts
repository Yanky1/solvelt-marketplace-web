/** Words and tones for what the API reports about an order (M5). Pure helpers: no I/O. */

export const STATUS_LABEL: Record<string, string> = {
  processing: "Being placed", new: "Received", accepted: "Accepted", on_hold: "On hold", partially_shipped: "Partly shipped", shipped: "Shipped",
  delivered: "Delivered", cancelled: "Cancelled", refunded: "Refunded",
};
export type Tone = "neutral" | "gold" | "ok" | "err";
export const statusLabel = (s: string): string => STATUS_LABEL[s] ?? "In progress";
export const statusTone = (s: string): Tone => (s === "delivered" ? "ok" : s === "cancelled" || s === "refunded" ? "err" : s === "shipped" || s === "partially_shipped" ? "gold" : "neutral");

export const CANCEL_REASONS: Record<string, string> = {
  changed_mind: "I changed my mind", ordered_by_mistake: "I ordered by mistake", found_better_price: "I found a better price", delivery_too_slow: "Delivery is too slow", other: "Another reason",
};
export const RETURN_REASONS: Record<string, string> = {
  damaged: "It arrived damaged", not_as_described: "It is not as described", wrong_item: "I got the wrong item", no_longer_needed: "I no longer need it", other: "Another reason",
};
export const RETURN_STATUS: Record<string, string> = {
  pending: "Sending your request", requested: "Waiting for the seller", approved: "Approved", rejected: "Declined", received: "Received by the seller", refunded: "Refunded", failed: "Could not be sent",
};
export const CANCEL_STATUS: Record<string, string> = {
  pending: "Sending your request", requested: "Waiting for the seller", rejected: "Declined", approved: "Approved", already_cancelled: "Already cancelled", failed: "Could not be sent",
};
export const ATTEMPT_REASON: Record<string, string> = {
  no_one_home: "no one was home", address_issue: "there was a problem with the address", refused: "the delivery was refused", unsafe: "it was not safe to leave it",
};
export const REFUND_STATUS: Record<string, string> = { reserved: "On its way", succeeded: "Refunded", rejected: "Rejected" };

export const TRACKING_STATUS: Record<string, string> = {
  pre_transit: "Label created", in_transit: "In transit", out_for_delivery: "Out for delivery", delivered: "Delivered", failure: "Delivery problem", returned: "Returned to sender", unknown: "Status unknown",
};
export const trackingLabel = (s: string | null): string => (s ? TRACKING_STATUS[s] ?? "In progress" : "");

/** A tracking link is only shown when it is a plain https link (the API already filters, this is the belt and braces). */
export function safeHttps(url: string | null | undefined): string | null {
  if (!url) return null;
  try { const u = new URL(url); return u.protocol === "https:" ? u.toString() : null; } catch { return null; }
}

/** Dates are shown in the visitor's own language/time zone on the server render as UTC-stable text: fixed locale, UTC, so server and client markup agree. */
export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", withTime
    ? { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }
    : { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

/** "between 2:00 PM and 4:00 PM UTC" for a local delivery window. */
export function formatWindow(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const f = (s: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(s));
  return `${f(start)} to ${f(end)} UTC`;
}

/** Where the buyer is in the order, as steps: accepted, shipped, delivered (cancelled/refunded end it). */
export function progressSteps(status: string): { label: string; done: boolean }[] {
  const order = ["new", "accepted", "partially_shipped", "shipped", "delivered"];
  const at = status === "on_hold" ? 1 : Math.max(0, order.indexOf(status));
  return [{ label: "Placed", done: true }, { label: "Accepted", done: at >= 1 }, { label: "Shipped", done: at >= 3 || status === "partially_shipped" }, { label: "Delivered", done: at >= 4 }];
}
