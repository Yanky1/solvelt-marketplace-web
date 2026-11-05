import type { GroupSelection, Quote, QuoteGroup } from "./api-client.server";
import { cleanField, readAddress, str, validateAddress, validateEmail, type AddressInput, type FieldErrors } from "./validation";

/** The delivery choice of one seller/brand group travels as one radio value: `carrier:<speed>` or `local:<windowId>:<date>`. */
export const deliveryField = (g: Pick<QuoteGroup, "sellerId" | "brandId">) => `delivery:${g.sellerId}:${g.brandId}`;
export const carrierValue = (speed: string) => `carrier:${speed}`;
export const localValue = (windowId: string, date: string) => `local:${windowId}:${date}`;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The choices in a submitted form, for the groups the buyer was shown: anything else in the form is ignored, and a malformed value is dropped (the API then picks its cheapest default). */
export function readSelections(form: FormData, groups: Pick<QuoteGroup, "sellerId" | "brandId">[]): GroupSelection[] {
  const out: GroupSelection[] = [];
  for (const g of groups) {
    const v = str(form, deliveryField(g));
    const carrier = /^carrier:([A-Za-z0-9_-]{1,40})$/.exec(v);
    if (carrier) { out.push({ sellerId: g.sellerId, brandId: g.brandId, speed: carrier[1]! }); continue; }
    const local = /^local:([A-Za-z0-9_-]{1,64}):(\d{4}-\d{2}-\d{2})$/.exec(v);
    if (local && ID.test(local[1]!) && DATE.test(local[2]!)) out.push({ sellerId: g.sellerId, brandId: g.brandId, localWindowId: local[1]!, localDate: local[2]! });
  }
  return out;
}

/** The value a group's radio should have selected after a quote. */
export function selectedValue(g: QuoteGroup): string {
  const s = g.selected;
  if (!s) return "";
  return s.kind === "local" && s.windowId && s.date ? localValue(s.windowId, s.date) : s.speed ? carrierValue(s.speed) : "";
}

/** The groups of a quote as the forms know them (what readSelections is given): never trust ids from the browser, take them from the server's own quote. */
export const groupsOf = (q: Pick<Quote, "groups">) => q.groups.map((g) => ({ sellerId: g.sellerId, brandId: g.brandId }));

export interface CheckoutValues extends AddressInput { email: string; giftMessage: string }

export function readCheckoutValues(form: FormData): CheckoutValues {
  return { ...readAddress(form), email: cleanField(form, "email").toLowerCase(), giftMessage: cleanField(form, "giftMessage").slice(0, 500) };
}

/** Field errors for the details step. A US address needs a two-letter state: the API refuses it otherwise, so say so here. */
export function validateCheckout(v: CheckoutValues, guest: boolean): FieldErrors {
  const e = validateAddress(v);
  if (v.country === "US" && !/^[A-Za-z]{2}$/.test(v.region)) e.region = "Enter the two-letter state, for example NY.";
  if (guest) { const m = validateEmail(v.email); if (m) e.email = m; }
  if (v.giftMessage.length > 500) e.giftMessage = "Use at most 500 characters.";
  return e;
}

/** Delivery estimate text from the API's two dates, as written (the API formats them yyyy-mm-dd). */
export const estimateText = (e: { earliest: string; latest: string }) => (e.earliest === e.latest ? `arrives ${e.earliest}` : `arrives ${e.earliest} to ${e.latest}`);

/** What the confirmation page says for an order status. */
export const ORDER_STATUS_TEXT: Record<string, { title: string; text: string; tone: "ok" | "wait" | "bad" }> = {
  pending_payment: { title: "Confirming your payment", text: "We are waiting for your bank to confirm the payment. This page updates by itself.", tone: "wait" },
  payment_processing: { title: "Your payment is processing", text: "Your payment method takes a little longer. We will email you as soon as it is confirmed.", tone: "wait" },
  paid: { title: "Payment received", text: "We are sending your order to the sellers. This page updates by itself.", tone: "wait" },
  placed: { title: "Thank you, your order is placed", text: "Each seller prepares their own part. You will get an email as each one ships.", tone: "ok" },
  failed: { title: "We could not place your order", text: "You have not been charged: any payment taken is being refunded to your card (it can take a few days to show). Please try again.", tone: "bad" },
  expired: { title: "This checkout expired", text: "Nothing was charged. Please go back to your cart and check out again.", tone: "bad" },
  superseded: { title: "This checkout was replaced", text: "You started a newer checkout of the same cart. Please use the latest one.", tone: "bad" },
};

// ---- the confirmation page and a guest's order-access token (review M2, M3, L3, L4) ----

/** Statuses an order never leaves: once the page has shown one, a guest's token has done its job (the emailed link remains). */
export const FINAL_ORDER_STATUSES: ReadonlySet<string> = new Set(["placed", "failed", "expired", "superseded"]);
/** Statuses the confirmation page keeps polling for. */
export const WAITING_ORDER_STATUSES: ReadonlySet<string> = new Set(["pending_payment", "payment_processing", "paid"]);

/** Query parameters Stripe (or anyone) may append to the return address: none of them is believed or kept. */
const RETURN_PARAMS = ["payment_intent", "payment_intent_client_secret", "redirect_status"] as const;
export const hasReturnParams = (url: URL): boolean => RETURN_PARAMS.some((p) => url.searchParams.has(p));

export interface GuestOrderGrant { n: string; t: string; e?: number }

/** The token for THIS order, or undefined: it is bound to one order number and to the expiry the API gave (unix seconds). */
export function guestTokenFor(go: GuestOrderGrant | undefined, number: string, now = Date.now() / 1000): string | undefined {
  if (!go || go.n !== number) return undefined;
  if (go.e !== undefined && go.e <= now) return undefined;
  return go.t;
}

/** The API's `guestOrderTokenExpiresAt` (ISO) in unix seconds; a missing or unreadable value means one day, never longer than the API's own date. */
export function guestExpiry(iso: string | undefined, now = Date.now() / 1000): number {
  const t = iso ? Date.parse(iso) / 1000 : NaN;
  const day = Math.floor(now) + 24 * 3600;
  return Number.isFinite(t) ? Math.min(Math.floor(t), Math.floor(now) + 7 * 24 * 3600) : day;
}

/** A token as the API issues it (url-safe characters, bounded): anything else in a link is not stored. */
export const looksLikeGuestToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9._~-]{16,120}$/.test(t);

export const POLL_INTERVAL_MS = 3000;
export const MAX_POLLS = 40;   // about two minutes

/**
 * Polls while an order is not final: every interval asks `revalidate` (only when the router is idle), and stops for good after `maxPolls` ticks. The tick COUNT lives here, outside any component
 * state, so a revalidation that flips the router's state never restarts the count (review M2: it did, and the page polled for ever on payment_processing).
 */
export function startPolling(revalidate: () => void, isIdle: () => boolean, intervalMs = POLL_INTERVAL_MS, maxPolls = MAX_POLLS): () => void {
  let ticks = 0;
  const t = setInterval(() => {
    if (++ticks > maxPolls) { clearInterval(t); return; }
    if (isIdle()) revalidate();
  }, intervalMs);
  return () => clearInterval(t);
}

/**
 * The publishable key the API hands over with a PaymentIntent. It must look like one (`pk_test_` or `pk_live_`), and outside production only a TEST key is ever used: a live key in a development or
 * test run is a misconfiguration that must not put the Payment Element on a real account (review: pk_test guard; decision M3W-09).
 */
export const publishableKeyOk = (key: string | null | undefined, production: boolean): key is string =>
  typeof key === "string" && (production ? /^pk_(test|live)_[A-Za-z0-9]{8,200}$/ : /^pk_test_[A-Za-z0-9]{8,200}$/).test(key);
