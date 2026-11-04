import type { NotificationItem } from "./api-client.server";
import { formatMoney } from "~/components/ui/display";

/** The email categories a buyer can switch (the API's names), with plain labels. */
export const CATEGORIES: { key: string; label: string; hint: string }[] = [
  { key: "order_updates", label: "Order updates", hint: "Accepted, cancelled, returns and failed deliveries" },
  { key: "shipped", label: "Shipped", hint: "When a seller ships your order" },
  { key: "out_for_delivery", label: "Out for delivery", hint: "On the day it reaches you" },
  { key: "delivered", label: "Delivered", hint: "When your order arrives" },
  { key: "refunds", label: "Refunds", hint: "When a refund is on its way" },
  { key: "messages", label: "Messages", hint: "When a seller writes to you" },
  { key: "bookings", label: "Bookings", hint: "Confirmations, changes and reminders" },
];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const seller = (n: NotificationItem): string => str(n.parameters?.sellerName) || "the seller";

/** One line for the notification centre. Built from the kind and non-personal parameters; unknown kinds get a safe generic line. */
export function notificationText(n: NotificationItem): string {
  const order = n.orderNumber ? `order ${n.orderNumber}` : "your order";
  switch (n.kind) {
    case "order_accepted": return `${seller(n)} accepted ${order}.`;
    case "order_shipped": return `${seller(n)} shipped ${order}${str(n.parameters?.carrier) ? ` with ${str(n.parameters?.carrier)}` : ""}.`;
    case "out_for_delivery": return `${order[0]?.toUpperCase()}${order.slice(1)} is out for delivery.`;
    case "order_delivered": return `${order[0]?.toUpperCase()}${order.slice(1)} was delivered.`;
    case "order_cancelled": return `${seller(n)} cancelled ${order}.`;
    case "cancellation_rejected": return `${seller(n)} could not cancel ${order}.`;
    case "return_approved": return `${seller(n)} approved your return for ${order}.`;
    case "return_rejected": return `${seller(n)} declined your return for ${order}.`;
    case "return_received": return `${seller(n)} received your return for ${order}.`;
    case "return_label_ready": return `Your return label for ${order} is ready.`;
    case "delivery_attempt_failed": return `A delivery attempt for ${order} did not work.`;
    case "refund_issued": {
      const cents = typeof n.parameters?.amountCents === "number" ? n.parameters.amountCents : null;
      return `${seller(n)} refunded${cents !== null ? ` ${formatMoney(cents, /^[A-Z]{3}$/.test(str(n.parameters?.currency)) ? str(n.parameters?.currency) : "USD")}` : ""} for ${order}.`;
    }
    case "message_received": return `${seller(n)} sent you a message${str(n.parameters?.subject) ? ` about ${str(n.parameters?.subject)}` : ""}.`;
    default:
      return n.kind.startsWith("booking_") ? `There is an update on your booking${str(n.parameters?.bookingNumber) ? ` ${str(n.parameters?.bookingNumber)}` : ""}.` : "There is an update on your account.";
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Where a notification leads: only our own account pages, built from ids that pass the same check as every path id. */
export function notificationLink(n: NotificationItem): string | null {
  if (n.kind === "message_received") { const t = str(n.parameters?.threadId); return SAFE_ID.test(t) ? `/account/messages/${encodeURIComponent(t)}` : "/account/messages"; }
  if (n.kind.startsWith("booking_")) return "/account/bookings";
  return n.orderNumber && SAFE_ID.test(n.orderNumber) ? `/account/orders/${encodeURIComponent(n.orderNumber)}` : null;
}
