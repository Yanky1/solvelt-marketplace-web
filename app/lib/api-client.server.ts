import { CART_TOKEN_HEADER, GUEST_ORDER_HEADER } from "./api-headers";
import { apiFetch, type ApiRequestContext } from "./api.server";
import { getConfig } from "./config.server";
import { isSafeId } from "./passkey.server";
import { cleanRef } from "./error-ref.server";

/**
 * Typed client for the buyer API. ASSUMED CONTRACT (docs/DESIGN.md W1-21): the API's auth endpoints are not
 * documented yet; shapes here are what the mock API in e2e/mock-api.mjs implements, to be confirmed by M1.
 */
import { safeHttps } from "./orders";
import type { Availability, BookingView, PolicyView, QuoteView } from "./bookings";
import { parseQuestions, parseReview, parseReviewPage, parseReviewable, type QuestionView, type ReviewPage, type ReviewView, type Reviewable } from "./reviews";
import { parseCard, parseItems, parseSummary, type ListCardView, type WishlistItemView, type WishlistSummary } from "./lists";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors?: Record<string, string>, public retryAfter?: number, public body?: unknown, public reference?: string) {
    super(message);
  }
}

export interface Profile { id: string; displayName: string; email: string; phone?: string }
export interface Address {
  id: string; fullName: string; line1: string; line2?: string; city: string; region?: string; postalCode: string; country: string; phone?: string; isDefault: boolean;
}
export type AddressBody = Omit<Address, "id">;
export interface PasskeyInfo { id: string; name: string; createdAt: string; lastUsedAt?: string }
export interface PasskeyChallenge { challengeId: string; options: Record<string, unknown> }

export interface ApiUser { id: string; displayName: string; email?: string }

// ---- demo data (test mode, M9; API repo docs/API.md "Demo data") ----
export interface DemoCounts { addresses: number; carts: number; cartLines: number; orders: number; bookings: number; threads: number; messages: number; notifications: number }
export interface DemoStatus { hasDemoData: boolean; counts: DemoCounts }
export interface DemoFill { batchId: string; created: boolean; counts: DemoCounts; notes: string[] }

/** Ids end up in URL paths: "." and ".." (or anything with separators) would be normalised by fetch onto other API routes. */
function pid(id: string): string {
  if (!isSafeId(id)) throw new ApiError(404, "not_found", "Not found");
  return encodeURIComponent(id);
}

/**
 * Password change and passkey removal end every session of the account; the API (M1-87) answers them with 200 `{ token }`, a session for the caller to carry on with (before that it
 * answered 204 and the caller's session lived on). Either is fine: this returns the new token, or undefined when there is none. Anything that is not a plausible token string is
 * ignored, so a malformed answer can never put a strange value into the sealed cookie.
 */
export function tokenOf(answer: unknown): string | undefined {
  const t = typeof answer === "object" && answer !== null ? (answer as { token?: unknown }).token : undefined;
  return typeof t === "string" && t.length >= 8 && t.length <= 512 && /^[\x21-\x7e]+$/.test(t) ? t : undefined;
}

async function call<T>(ctx: ApiRequestContext, path: string, body?: unknown, method?: string, headers?: Record<string, string>, form?: FormData): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(getConfig(), ctx, path, { ...(body !== undefined ? { body } : {}), ...(form ? { form } : {}), ...(method ? { method } : {}), ...(headers ? { headers } : {}), signal: AbortSignal.timeout(8000) });
  } catch {
    // no answer at all (unreachable, timeout): apiFetch has made and logged the reference
    throw new ApiError(503, "unavailable", "The service is temporarily unavailable. Please try again.", undefined, undefined, undefined, ctx.errorRef?.id);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  if (!res.ok) {
    const e = (json ?? {}) as { code?: string; message?: string; errors?: Record<string, string> };
    const retry = Number(res.headers.get("retry-after"));
    // A server fault keeps the API's own correlation id (it logged the same one); apiFetch put it, or one made here for a proxy page, in the request's holder: that is the page's "Reference".
    const ref = res.status >= 500 ? ctx.errorRef?.id : cleanRef(res.headers.get("x-correlation-id"));
    throw new ApiError(res.status, e.code ?? "error", e.message ?? "Request failed.", e.errors, Number.isFinite(retry) ? retry : undefined, json, ref);
  }
  return json as T;
}

// ---- buyer orders (M5; API repo docs/API.md "Buyer orders") ----
export interface OrderListGroup { sellerOrderNumber: string | null; sellerName: string; brandName: string; status: string; itemCount: number; firstItem: string | null }
export interface OrderListItem { number: string; createdAt: string; currency: string; totalCents: number; refundedCents: number; groups: OrderListGroup[] }
export interface OrderList { orders: OrderListItem[]; next: { before: string; beforeId: string } | null }
export interface OrderLineView { lineId: string; title: string; variantName: string; quantity: number; unitPriceCents: number; lineTotalCents: number; taxCents: number; shippedQty: number; cancelledQty: number; returnedQty: number; refundedQty: number; returnableQty: number }
export interface TimelineEvent { status: string | null; detail: string | null; location: string | null; at: string | null }
export interface ShipmentView {
  id: string; method: string; carrier: string | null; service: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null; deliveredAt: string | null; voided: boolean;
  trackingStatus: string | null; trackingStatusDetail: string | null; eta: string | null; etaWindowStart: string | null; etaWindowEnd: string | null; driverFirstName: string | null; placement: string | null;
  timeline: TimelineEvent[] | null; position: { at: string } | null; proofCount: number; lines: { lineId: string; quantity: number }[];
}
export interface ReturnView {
  returnId: string; status: string; reason: string; decisionNote: string | null; createdAt: string; lines: { lineId: string; quantity: number }[];
  label: { url: string; expiresAt: string; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null } | null; canRefreshLabel: boolean;
}
export interface RefundView { amountCents: number; shippingCents: number; status: string; reason: string; createdAt: string }
export interface OrderGroupView {
  sellerOrderNumber: string | null; sellerName: string; brandName: string; status: string; deliveryKind: string; shippingSpeed: string | null; localDate: string | null;
  itemsCents: number; shippingCents: number; taxCents: number; totalCents: number; refundedCents: number; oversold: boolean;
  acceptedAt: string | null; shippedAt: string | null; deliveredAt: string | null; deliveredBy: string | null; cancelledAt: string | null;
  deliveryAttemptsFailed: number; lastAttemptFailedReason: string | null; buyerConfirmedAt: string | null;
  canCancel: boolean; canConfirmDelivery: boolean; canReturn: boolean;
  cancelRequest: { status: string; reason: string; decisionNote: string | null; createdAt: string } | null;
  lines: OrderLineView[]; shipments: ShipmentView[]; returns: ReturnView[]; refunds: RefundView[];
}
export interface OrderDetail {
  number: string; status: string; createdAt: string; paidAt: string | null; currency: string; itemsCents: number; shippingCents: number; taxCents: number; totalCents: number; refundedCents: number;
  shipTo: { name: string; line1: string; line2: string | null; city: string; region: string | null; postalCode: string; country: string }; giftMessage: string | null; groups: OrderGroupView[];
}
/** Rebuilds the shipments' `position` as `{ at }` only, whatever else the API sent. */
export function withoutCoordinates(o: OrderDetail): OrderDetail {
  return { ...o, groups: (o.groups ?? []).map((g) => ({ ...g, shipments: (g.shipments ?? []).map((s) => ({ ...s, position: s.position && typeof s.position.at === "string" ? { at: s.position.at } : null })),
    returns: (g.returns ?? []).map((r) => ({ ...r, label: r.label && safeHttps(r.label.url) ? r.label : null })) })) };   // a label link that is not https is dropped before it can be rendered or serialised
}
export interface ReturnInput { sellerOrderNumber: string; reason: string; comment: string; lines: { lineId: string; quantity: number }[] }

// ---- wishlists and recently viewed (M6; API docs "Wishlists and recently viewed") ----
export interface WishlistList { limit: number; itemLimit: number; wishlists: WishlistSummary[] }
export interface WishlistDetail { wishlist: WishlistSummary; items: WishlistItemView[] }
export interface SharedWishlist { name: string; items: { listing: ListCardView }[] }

// ---- notifications (M5; API docs "Notifications") ----
export interface NotificationItem { id: string; kind: string; category: string; orderNumber: string | null; sellerOrderNumber: string | null; parameters: Record<string, unknown> | null; createdAt: string; read: boolean }
export interface NotificationList { unreadCount: number; notifications: NotificationItem[]; next: { before: string; beforeId: string } | null }
export type NotificationPrefs = { email: Record<string, boolean> };

// ---- messages (M5; API docs "Messages") ----
export interface ThreadSummary { id: string; kind: string; subject: string; sellerName: string | null; orderNumber: string | null; listingId: string | null; marketplaceBookingId?: string | null; lastMessageAt: string; unreadCount: number; preview: string }
export interface ThreadList { unreadCount: number; threads: ThreadSummary[]; next: { before: string; beforeId: string } | null }
export interface MessageAttachmentView { id: string; fileName: string; size: number; type: string | null; available: boolean }
export interface ThreadMessageView { id: string; direction: "buyer" | "seller"; status: string; sentAt: string; read: boolean; reported: boolean; hidden: boolean; text: string | null; attachments: MessageAttachmentView[] }
export interface ThreadView { thread: { id: string; kind: string; subject: string; sellerName: string | null; listingId: string | null; marketplaceBookingId?: string | null }; messages: ThreadMessageView[]; older: string | null }
export interface SendMessageInput { threadId?: string; orderNumber?: string; sellerOrderNumber?: string; listingId?: string; marketplaceBookingId?: string; text: string; acknowledgeWarning?: boolean }

/** Raw GET for binary answers (proof images, message files): the caller streams it to the browser with its own safe headers. */
async function raw(ctx: ApiRequestContext, path: string): Promise<Response> {
  try { return await apiFetch(getConfig(), ctx, path, { signal: AbortSignal.timeout(20000) }); } catch { throw new ApiError(503, "unavailable", "The service is temporarily unavailable. Please try again."); }
}

/** Raw POST (no body): the data export streams a file the caller sends on with its own safe headers. */
async function rawPost(ctx: ApiRequestContext, path: string): Promise<Response> {
  try { return await apiFetch(getConfig(), ctx, path, { method: "POST", signal: AbortSignal.timeout(30000) }); } catch { throw new ApiError(503, "unavailable", "The service is temporarily unavailable. Please try again."); }
}

// ---- cart (M3; API repo docs/API.md "Cart") ----
export interface CartLine { id: string; listingId: string; variantId: string; slug: string; title: string; variantName: string; imageId: string | null; quantity: number; unitPriceCents: number; compareAtCents: number | null; lineTotalCents: number; status: "ok" | "unavailable"; previousUnitPriceCents: number | null }
export interface CartGroup { sellerId: string; sellerName: string; brandId: string; brandName: string; subtotalCents: number; lines: CartLine[] }
/** `cartToken` is returned ONCE, when the API creates a guest cart: the BFF seals it into the session cookie and never lets it reach the browser. */
export interface Cart { currency: string; groups: CartGroup[]; itemCount: number; subtotalCents: number; canCheckout: boolean; cartToken?: string }
export const EMPTY_CART: Cart = { currency: "USD", groups: [], itemCount: 0, subtotalCents: 0, canCheckout: false };
/** The guest cart token travels in a header, and only while nobody is signed in (a signed-in buyer's cart is the account's). */
export const cartHeaders = (ctx: ApiRequestContext, cartToken?: string): Record<string, string> | undefined => (!ctx.sessionToken && cartToken ? { [CART_TOKEN_HEADER]: cartToken } : undefined);

// ---- checkout (M3; API repo docs/API.md "Checkout") ----
export interface ShippingOption { speed: string; priceCents: number; free: boolean; estimate: { earliest: string; latest: string } }
export interface LocalWindow { windowId: string; date: string; start: string; end: string; remaining: number }
export interface QuoteLine { lineId: string; listingId: string; variantId: string; title: string; variantName: string; quantity: number; unitPriceCents: number; lineTotalCents: number; taxCents: number }
export interface QuoteGroup {
  sellerId: string; sellerName: string; brandId: string; brandName: string; lines: QuoteLine[]; itemsCents: number; shippingOptions: ShippingOption[]; unavailableSpeeds: { speed: string; reason: string }[];
  local: { eligible: boolean; reason: string | null; feeCents: number | null; timeZone: string | null; windows: LocalWindow[] } | null;
  selected: { kind: "carrier" | "local"; speed: string | null; windowId: string | null; date: string | null; shippingCents: number } | null;
  shippingCents: number; shippingTaxCents: number; taxCents: number; totalCents: number;
}
/** `quoteHash` binds a checkout to exactly this quote (price, tax, delivery, destination) and expires; checkout sends it back. */
export interface Quote { currency: string; groups: QuoteGroup[]; itemsCents: number; shippingCents: number; taxCents: number; totalCents: number; canPay: boolean; quoteHash: string; expiresAt: string }
export interface QuoteAddress { country: string; region?: string; postalCode: string }
export interface GroupSelection { sellerId: string; brandId: string; speed?: string | null; localWindowId?: string | null; localDate?: string | null }
export interface CheckoutAddress { name: string; line1: string; line2?: string; city: string; region?: string; postalCode: string; country: string; phone?: string }
export interface Placed { orderNumber: string; status: string; quote: Quote; payment: { provider: string; clientSecret: string; publishableKey: string | null } | null; guestOrderToken?: string; guestOrderTokenExpiresAt?: string }
export interface CheckoutOrder { number: string; status: string; currency?: string; totalCents?: number; createdAt: string; paidAt?: string | null; claimed?: boolean; groups?: { sellerName: string; brandName: string; deliveryKind: string; shippingSpeed: string | null; localDate: string | null; totalCents: number; lines: { title: string; variantName: string; quantity: number; lineTotalCents: number }[] }[] }
// ---- services and bookings (M4; API repo docs/API.md "Services (M4)") ----
export interface ServiceOptions {
  available: boolean; addOns: { id: string; name: string; description?: string; priceCents: number; extraMinutes: number }[];
  intakeQuestions: { id: string; label: string; kind: "text" | "longText" | "choice" | "yesNo" | "number"; required: boolean; choices?: string[]; maxLength?: number }[];
  providers: { providerId: string; displayName: string }[]; assignment?: string | null; policy?: PolicyView | null; travelFeeCents?: number | null;
}
export interface BookingPayment { provider: string; clientSecret: string; publishableKey: string | null }
export interface HoldBody { listingId: string; start: string; location: string; durationMinutes?: number; providerId?: string; addOnIds?: string[]; phone?: string; address?: Record<string, string> }
export interface CancelPreview { feeKnown: boolean; feeCents?: number; refundCents?: number; totalCents: number; withinFreeWindow: boolean; freeUntil?: string; currency: string }
const guestOrderHeader = (token?: string): Record<string, string> | undefined => (token ? { [GUEST_ORDER_HEADER]: token } : undefined);

export const api = {
  /** Public: available times (the BFF forwards only the allow-listed query). */
  serviceAvailability: (ctx: ApiRequestContext, listingId: string, query: string) => call<Availability>(ctx, `/api/v1/services/${pid(listingId)}/availability?${query}`),
  serviceOptions: (ctx: ApiRequestContext, listingId: string) => call<ServiceOptions>(ctx, `/api/v1/services/${pid(listingId)}/options`),
  /** The API answers `201 { created: true, booking }` (`200 { created: false, booking }` for a repeated key): docs/API.md, Bookings. */
  holdBooking: (ctx: ApiRequestContext, b: HoldBody, key: string) => call<{ created: boolean; booking: BookingView }>(ctx, "/api/v1/bookings/holds", b, undefined, { "Idempotency-Key": key }),
  bookings: (ctx: ApiRequestContext) => call<{ bookings: BookingView[] }>(ctx, "/api/v1/bookings"),
  booking: (ctx: ApiRequestContext, id: string) => call<BookingView>(ctx, `/api/v1/bookings/${pid(id)}`),
  checkoutBooking: (ctx: ApiRequestContext, id: string, b: { intake?: { id: string; answer: string }[]; phone?: string }) => call<{ booking: BookingView; payment: BookingPayment }>(ctx, `/api/v1/bookings/${pid(id)}/checkout`, b),
  cancelBookingPreview: (ctx: ApiRequestContext, id: string) => call<CancelPreview>(ctx, `/api/v1/bookings/${pid(id)}/cancel-preview`),
  requestQuote: (ctx: ApiRequestContext, b: Record<string, unknown>, key: string) => call<{ created: boolean; quote: QuoteView }>(ctx, "/api/v1/quotes", b, undefined, { "Idempotency-Key": key }),
  quoteRequests: (ctx: ApiRequestContext) => call<{ quotes: QuoteView[] }>(ctx, "/api/v1/quotes"),
  quoteRequest: (ctx: ApiRequestContext, id: string) => call<QuoteView>(ctx, `/api/v1/quotes/${pid(id)}`),
  acceptQuote: (ctx: ApiRequestContext, id: string, b: { start: string; phone?: string; intake?: { id: string; answer: string }[]; addOnIds?: string[] }) => call<{ created: boolean; quote: QuoteView; booking: BookingView }>(ctx, `/api/v1/quotes/${pid(id)}/accept`, b),
  declineQuote: (ctx: ApiRequestContext, id: string, reason?: string) => call<{ quote: QuoteView }>(ctx, `/api/v1/quotes/${pid(id)}/decline`, reason ? { reason } : {}),
  extraChargeAccept: (ctx: ApiRequestContext, id: string, expectedAmountCents?: number) => call<{ amountCents: number; payment: BookingPayment }>(ctx, `/api/v1/bookings/${pid(id)}/extra-charge/accept`, expectedAmountCents ? { expectedAmountCents } : {}),
  extraChargeDecline: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/bookings/${pid(id)}/extra-charge/decline`, {}),
  rescheduleBooking: (ctx: ApiRequestContext, id: string, newStart: string, key: string) => call<{ booking: BookingView }>(ctx, `/api/v1/bookings/${pid(id)}/reschedule`, { newStart }, undefined, { "Idempotency-Key": key }),
  bookingProposal: (ctx: ApiRequestContext, id: string, accept: boolean) => call<{ booking: BookingView }>(ctx, `/api/v1/bookings/${pid(id)}/proposal`, { accept }),
  acknowledgeReschedule: (ctx: ApiRequestContext, id: string) => call<{ booking: BookingView }>(ctx, `/api/v1/bookings/${pid(id)}/acknowledge-reschedule`, {}),
  bookingCalendar: (ctx: ApiRequestContext, id: string) => raw(ctx, `/api/v1/bookings/${pid(id)}/calendar.ics`),
  cancelBooking: (ctx: ApiRequestContext, id: string, reason?: string) => call<{ booking: BookingView }>(ctx, `/api/v1/bookings/${pid(id)}/cancel`, reason ? { reason } : {}),
  threads: (ctx: ApiRequestContext, cursor?: { before: string; beforeId: string }) =>
    call<ThreadList>(ctx, `/api/v1/messages/threads${cursor ? `?before=${encodeURIComponent(cursor.before)}&beforeId=${encodeURIComponent(cursor.beforeId)}` : ""}`),
  thread: (ctx: ApiRequestContext, id: string, before?: string) => call<ThreadView>(ctx, `/api/v1/messages/threads/${pid(id)}${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  sendMessage: (ctx: ApiRequestContext, b: SendMessageInput) => call<{ threadId: string; messageId: string; status: string }>(ctx, "/api/v1/messages", b),
  markThreadRead: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/messages/threads/${pid(id)}/read`, {}),
  reportMessage: (ctx: ApiRequestContext, id: string, b: { reason: string; note?: string }) => call<{ reported: boolean }>(ctx, `/api/v1/messages/${pid(id)}/report`, b),
  messageAttachment: (ctx: ApiRequestContext, id: string) => raw(ctx, `/api/v1/messages/attachments/${pid(id)}`),
  quote: (ctx: ApiRequestContext, cartToken: string | undefined, b: { address: QuoteAddress; selections: GroupSelection[] }) => call<Quote>(ctx, "/api/v1/checkout/quote", b, undefined, cartHeaders(ctx, cartToken)),
  placeOrder: (ctx: ApiRequestContext, cartToken: string | undefined, b: { address: CheckoutAddress; selections: GroupSelection[]; giftMessage?: string; quoteHash: string; email?: string }) => call<Placed>(ctx, "/api/v1/checkout", b, undefined, cartHeaders(ctx, cartToken)),
  /** The buyer's own order (Bearer) or a guest's through the order-access token (never both). */
  checkoutOrder: (ctx: ApiRequestContext, number: string, guestToken?: string) => call<CheckoutOrder>(ctx, `/api/v1/checkout/orders/${pid(number)}`, undefined, undefined, ctx.sessionToken ? undefined : guestOrderHeader(guestToken)),
  cart: (ctx: ApiRequestContext, cartToken?: string) => call<Cart>(ctx, "/api/v1/cart", undefined, undefined, cartHeaders(ctx, cartToken)),
  cartAdd: (ctx: ApiRequestContext, cartToken: string | undefined, b: { variantId: string; quantity: number }) => call<Cart>(ctx, "/api/v1/cart/lines", b, undefined, cartHeaders(ctx, cartToken)),
  cartSetQuantity: (ctx: ApiRequestContext, cartToken: string | undefined, lineId: string, quantity: number) => call<Cart>(ctx, `/api/v1/cart/lines/${pid(lineId)}`, { quantity }, "PATCH", cartHeaders(ctx, cartToken)),
  cartRemove: (ctx: ApiRequestContext, cartToken: string | undefined, lineId: string) => call<Cart>(ctx, `/api/v1/cart/lines/${pid(lineId)}`, undefined, "DELETE", cartHeaders(ctx, cartToken)),
  /** At sign-in: moves the guest cart into the signed-in buyer's cart (the request carries the NEW Bearer). */
  cartMerge: (ctx: ApiRequestContext, guestToken: string) => call<Cart>(ctx, "/api/v1/cart/merge", { guestToken }),

  notifications: (ctx: ApiRequestContext, cursor?: { before: string; beforeId: string }) =>
    call<NotificationList>(ctx, `/api/v1/notifications${cursor ? `?before=${encodeURIComponent(cursor.before)}&beforeId=${encodeURIComponent(cursor.beforeId)}` : ""}`),
  markNotificationRead: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/notifications/${pid(id)}/read`, {}),
  markAllNotificationsRead: (ctx: ApiRequestContext) => call<void>(ctx, "/api/v1/notifications/read-all", {}),
  notificationPrefs: (ctx: ApiRequestContext) => call<NotificationPrefs>(ctx, "/api/v1/notifications/preferences"),
  saveNotificationPrefs: (ctx: ApiRequestContext, email: Record<string, boolean>) => call<NotificationPrefs>(ctx, "/api/v1/notifications/preferences", { email }, "PUT"),
  /** Anonymous: the signed token from a mail link is the credential. Only ever switches mail OFF. */
  unsubscribe: (ctx: ApiRequestContext, token: string) => call<void>(ctx, "/api/v1/notifications/unsubscribe", { token }),
  orders: (ctx: ApiRequestContext, cursor?: { before: string; beforeId: string }) =>
    call<OrderList>(ctx, `/api/v1/orders${cursor ? `?before=${encodeURIComponent(cursor.before)}&beforeId=${encodeURIComponent(cursor.beforeId)}` : ""}`),
  /** The driver's coordinates are dropped HERE, before anything can reach a loader, the hydration payload or a .data response: the page only ever says "on the way" (M5W-05). */
  order: async (ctx: ApiRequestContext, number: string): Promise<OrderDetail> => withoutCoordinates(await call<OrderDetail>(ctx, `/api/v1/orders/${pid(number)}`)),
  requestCancel: (ctx: ApiRequestContext, number: string, b: { sellerOrderNumber: string; reason: string; note: string }) => call<{ requestId: string; status: string }>(ctx, `/api/v1/orders/${pid(number)}/cancel-requests`, b),
  requestReturn: (ctx: ApiRequestContext, number: string, b: ReturnInput, idempotencyKey: string) =>
    call<{ returnId: string; status: string }>(ctx, `/api/v1/orders/${pid(number)}/return-requests`, b, undefined, { "Idempotency-Key": idempotencyKey }),
  confirmDelivery: (ctx: ApiRequestContext, number: string, sellerOrderNumber: string) => call<{ status: string }>(ctx, `/api/v1/orders/${pid(number)}/delivery-confirmations`, { sellerOrderNumber }),
  refreshReturnLabel: (ctx: ApiRequestContext, number: string, returnId: string) => call<{ labelUrl: string; labelUrlExpiresAt: string }>(ctx, `/api/v1/orders/${pid(number)}/returns/${pid(returnId)}/label-link`, {}),
  proofImage: (ctx: ApiRequestContext, number: string, shipmentId: string, index: number) => raw(ctx, `/api/v1/orders/${pid(number)}/shipments/${pid(shipmentId)}/proof/${Math.trunc(index)}`),
  signUp: (ctx: ApiRequestContext, b: { email: string; password: string; displayName: string }) => call<void>(ctx, "/api/v1/auth/sign-up", b),
  resendVerification: (ctx: ApiRequestContext, email: string) => call<void>(ctx, "/api/v1/auth/resend-verification", { email }),
  /** O-16: verifying also needs the password chosen at sign-up (a wrong one answers the same generic 400 and leaves the link valid). */
  verifyEmail: (ctx: ApiRequestContext, b: { token: string; password: string }) => call<void>(ctx, "/api/v1/auth/verify-email", b),
  /** Step-up: 204 = right password, and this API session's authenticated-at clock is now (a replayed cookie cannot reset it). */
  /** "Download my data" (API M5-32): the buyer's own data as one JSON file. */
  dataExport: (ctx: ApiRequestContext) => rawPost(ctx, "/api/v1/account/data-export"),
  /** Deletes the account (soft delete now, erasure by the API's job): needs the password and a recent sign-in. */
  deleteAccount: (ctx: ApiRequestContext, password: string) => call<void>(ctx, "/api/v1/account/delete", { password }),
  reauthenticate: (ctx: ApiRequestContext, password: string) => call<void>(ctx, "/api/v1/auth/reauthenticate", { password }),
  signIn: (ctx: ApiRequestContext, b: { email: string; password: string }) => call<{ token: string; user: ApiUser }>(ctx, "/api/v1/auth/sign-in", b),
  signOut: (ctx: ApiRequestContext) => call<void>(ctx, "/api/v1/auth/sign-out", {}),
  signOutAll: (ctx: ApiRequestContext) => call<void>(ctx, "/api/v1/auth/sign-out-all", {}),
  forgotPassword: (ctx: ApiRequestContext, email: string) => call<void>(ctx, "/api/v1/auth/forgot-password", { email }),
  resetPassword: (ctx: ApiRequestContext, b: { token: string; password: string }) => call<void>(ctx, "/api/v1/auth/reset-password", b),
  me: (ctx: ApiRequestContext) => call<ApiUser>(ctx, "/api/v1/account/me"),
  profile: (ctx: ApiRequestContext) => call<Profile>(ctx, "/api/v1/account/profile"),
  updateProfile: (ctx: ApiRequestContext, b: { displayName: string; phone: string }) => call<Profile>(ctx, "/api/v1/account/profile", b, "PUT"),
  reviews: async (ctx: ApiRequestContext, listingId: string, q: { sort: string; rating: number | null; page: number }): Promise<ReviewPage> =>
    parseReviewPage(await call<unknown>(ctx, `/api/v1/reviews?listingId=${pid(listingId)}&sort=${encodeURIComponent(q.sort)}${q.rating ? `&rating=${q.rating}` : ""}&page=${q.page}`)),
  reviewable: async (ctx: ApiRequestContext, listingId: string): Promise<Reviewable[]> => parseReviewable((await call<{ items?: unknown }>(ctx, `/api/v1/reviews/eligible?listingId=${pid(listingId)}`)).items),
  createReview: (ctx: ApiRequestContext, b: { kind: string; targetId: string; rating: number; text: string }) => call<unknown>(ctx, "/api/v1/reviews", b).then(parseReview),
  editReview: (ctx: ApiRequestContext, id: string, b: { rating: number; text: string }) => call<unknown>(ctx, `/api/v1/reviews/${pid(id)}`, b, "PATCH").then(parseReview),
  voteReview: (ctx: ApiRequestContext, id: string, on: boolean) => call<void>(ctx, `/api/v1/reviews/${pid(id)}/helpful`, undefined, on ? "PUT" : "DELETE"),
  reportReview: (ctx: ApiRequestContext, id: string, b: { reason: string; note?: string }, reply = false) => call<void>(ctx, `/api/v1/reviews/${pid(id)}/${reply ? "reply/" : ""}report`, b),
  uploadReviewPhoto: (ctx: ApiRequestContext, id: string, form: FormData) => call<{ id: string }>(ctx, `/api/v1/reviews/${pid(id)}/photos`, undefined, "POST", undefined, form),
  deleteReviewPhoto: (ctx: ApiRequestContext, id: string, photoId: string) => call<void>(ctx, `/api/v1/reviews/${pid(id)}/photos/${pid(photoId)}`, undefined, "DELETE"),
  myReviews: async (ctx: ApiRequestContext): Promise<{ review: ReviewView; listing: { title: string; slug: string } | null }[]> => {
    const r = await call<{ reviews?: { review?: unknown; listing?: { title?: unknown; slug?: unknown } | null }[] }>(ctx, "/api/v1/account/reviews");
    return (r.reviews ?? []).flatMap((x) => { const v = parseReview(x.review); return v ? [{ review: v, listing: x.listing && typeof x.listing.title === "string" && typeof x.listing.slug === "string" ? { title: x.listing.title, slug: x.listing.slug } : null }] : []; });
  },
  askQuestion: (ctx: ApiRequestContext, b: { listingId: string; text: string }) => call<unknown>(ctx, "/api/v1/questions", b),
  myQuestions: async (ctx: ApiRequestContext): Promise<QuestionView[]> => parseQuestions((await call<{ questions?: unknown }>(ctx, "/api/v1/account/questions")).questions),
  reviewPhoto: (ctx: ApiRequestContext, photoId: string) => apiFetch(getConfig(), ctx, `/api/v1/reviews/photos/${pid(photoId)}`, { signal: AbortSignal.timeout(8000) }),

  wishlists: async (ctx: ApiRequestContext): Promise<WishlistList> => {
    const r = await call<{ limit?: number; itemLimit?: number; wishlists?: unknown[] }>(ctx, "/api/v1/wishlists");
    return { limit: r.limit ?? 20, itemLimit: r.itemLimit ?? 200, wishlists: (r.wishlists ?? []).map(parseSummary).filter((w): w is WishlistSummary => w !== null) };
  },
  wishlist: async (ctx: ApiRequestContext, id: string): Promise<WishlistDetail> => {
    const r = await call<{ wishlist?: unknown; items?: unknown }>(ctx, `/api/v1/wishlists/${pid(id)}`);
    const w = parseSummary(r.wishlist);
    if (!w) throw new ApiError(502, "bad_response", "Unexpected answer.");
    return { wishlist: w, items: parseItems(r.items) };
  },
  createWishlist: (ctx: ApiRequestContext, name: string) => call<unknown>(ctx, "/api/v1/wishlists", { name }).then(parseSummary),
  renameWishlist: (ctx: ApiRequestContext, id: string, name: string) => call<unknown>(ctx, `/api/v1/wishlists/${pid(id)}`, { name }, "PATCH"),
  deleteWishlist: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/wishlists/${pid(id)}`, undefined, "DELETE"),
  addWishlistItem: (ctx: ApiRequestContext, id: string, listingId: string) => call<void>(ctx, `/api/v1/wishlists/${pid(id)}/items/${pid(listingId)}`, undefined, "PUT"),
  removeWishlistItem: (ctx: ApiRequestContext, id: string, listingId: string) => call<void>(ctx, `/api/v1/wishlists/${pid(id)}/items/${pid(listingId)}`, undefined, "DELETE"),
  wishlistMembership: async (ctx: ApiRequestContext, listingId: string): Promise<string[]> => {
    const r = await call<{ membership?: Record<string, unknown> }>(ctx, `/api/v1/wishlists/membership?listingIds=${pid(listingId)}`);
    const ids = r.membership?.[listingId];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  },
  shareWishlist: async (ctx: ApiRequestContext, id: string): Promise<string> => {
    const r = await call<{ shareKey?: unknown }>(ctx, `/api/v1/wishlists/${pid(id)}/share`, {});
    if (typeof r.shareKey !== "string" || !isSafeId(r.shareKey)) throw new ApiError(502, "bad_response", "Unexpected answer.");
    return r.shareKey;
  },
  unshareWishlist: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/wishlists/${pid(id)}/share`, undefined, "DELETE"),
  sharedWishlist: async (ctx: ApiRequestContext, key: string): Promise<SharedWishlist> => {
    const r = await call<{ name?: unknown; items?: unknown[] }>(ctx, `/api/v1/shared-wishlists/${pid(key)}`);
    const items = (r.items ?? []).flatMap((i) => { const c = parseCard((i as { listing?: unknown })?.listing); return c ? [{ listing: c }] : []; });
    return { name: typeof r.name === "string" ? r.name.slice(0, 240) : "", items };
  },
  recentlyViewed: async (ctx: ApiRequestContext): Promise<ListCardView[]> => {
    const r = await call<{ items?: { listing?: unknown }[] }>(ctx, "/api/v1/recently-viewed");
    return (r.items ?? []).flatMap((i) => { const c = parseCard(i?.listing); return c ? [c] : []; });
  },
  recordViewed: (ctx: ApiRequestContext, listingId: string) => call<void>(ctx, `/api/v1/recently-viewed/${pid(listingId)}`, undefined, "PUT"),
  mergeViewed: (ctx: ApiRequestContext, listingIds: string[]) => call<void>(ctx, "/api/v1/recently-viewed/merge", { listingIds: listingIds.slice(0, 20) }),
  clearViewed: (ctx: ApiRequestContext) => call<void>(ctx, "/api/v1/recently-viewed", undefined, "DELETE"),

  addresses: (ctx: ApiRequestContext) => call<Address[]>(ctx, "/api/v1/account/addresses"),
  address: (ctx: ApiRequestContext, id: string) => call<Address>(ctx, `/api/v1/account/addresses/${pid(id)}`),
  createAddress: (ctx: ApiRequestContext, b: AddressBody) => call<Address>(ctx, "/api/v1/account/addresses", b),
  updateAddress: (ctx: ApiRequestContext, id: string, b: AddressBody) => call<Address>(ctx, `/api/v1/account/addresses/${pid(id)}`, b, "PUT"),
  deleteAddress: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/account/addresses/${pid(id)}`, undefined, "DELETE"),
  setDefaultAddress: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/account/addresses/${pid(id)}/default`, {}),
  passkeys: (ctx: ApiRequestContext) => call<PasskeyInfo[]>(ctx, "/api/v1/account/passkeys"),
  passkeyRegistrationOptions: (ctx: ApiRequestContext) => call<PasskeyChallenge>(ctx, "/api/v1/account/passkeys/options", {}),
  registerPasskey: (ctx: ApiRequestContext, b: { challengeId: string; name: string; credential: unknown }) => call<PasskeyInfo>(ctx, "/api/v1/account/passkeys", b),
  /** Removes every passkey (one mail). 403 = sign in again first; 409 no_passkeys / last_sign_in_method. An API that predates it answers 404 or 405. */
  deleteAllPasskeys: (ctx: ApiRequestContext) => call<unknown>(ctx, "/api/v1/account/passkeys", undefined, "DELETE").then(tokenOf),
  /** 204; `removePasskeys: true` also removes every passkey in the same step (an older API ignores the field). 403 = sign in again; 401 = wrong current password; 409 account_changed; 422 weak password. */
  changePassword: (ctx: ApiRequestContext, b: { currentPassword: string; newPassword: string; removePasskeys?: boolean }) => call<unknown>(ctx, "/api/v1/account/password", b).then(tokenOf),
  deletePasskey: (ctx: ApiRequestContext, id: string) => call<unknown>(ctx, `/api/v1/account/passkeys/${pid(id)}`, undefined, "DELETE").then(tokenOf),
  passkeySignInOptions: (ctx: ApiRequestContext) => call<PasskeyChallenge>(ctx, "/api/v1/auth/passkey/options", {}),
  passkeySignIn: (ctx: ApiRequestContext, b: { challengeId: string; credential: unknown }) => call<{ token: string; user: ApiUser }>(ctx, "/api/v1/auth/passkey/sign-in", b),
  // Demo data (404 from the API while its Demo:Enabled is off).
  demoStatus: (ctx: ApiRequestContext) => call<DemoStatus>(ctx, "/api/v1/demo/status"),
  demoFill: (ctx: ApiRequestContext) => call<DemoFill>(ctx, "/api/v1/demo/fill", {}),
  demoRemove: (ctx: ApiRequestContext) => call<{ removed: DemoCounts }>(ctx, "/api/v1/demo/remove", {}),
  /** Test-only: marks an unverified account verified. Takes the credentials because an unverified account has no session. */
  demoVerify: (ctx: ApiRequestContext, b: { email: string; password: string }) => call<void>(ctx, "/api/v1/demo/verify", b),
};
