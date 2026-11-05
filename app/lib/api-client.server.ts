import { CART_TOKEN_HEADER, GUEST_ORDER_HEADER } from "./api-headers";
import { apiFetch, type ApiRequestContext } from "./api.server";
import { getConfig } from "./config.server";
import { isSafeId } from "./passkey.server";

/**
 * Typed client for the buyer API. ASSUMED CONTRACT (docs/DESIGN.md W1-21): the API's auth endpoints are not
 * documented yet; shapes here are what the mock API in e2e/mock-api.mjs implements, to be confirmed by M1.
 */
import { safeHttps } from "./orders";
import type { Availability, BookingView } from "./bookings";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors?: Record<string, string>, public retryAfter?: number, public body?: unknown) {
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

async function call<T>(ctx: ApiRequestContext, path: string, body?: unknown, method?: string, headers?: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(getConfig(), ctx, path, { ...(body !== undefined ? { body } : {}), ...(method ? { method } : {}), ...(headers ? { headers } : {}), signal: AbortSignal.timeout(8000) });
  } catch {
    throw new ApiError(503, "unavailable", "The service is temporarily unavailable. Please try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  if (!res.ok) {
    const e = (json ?? {}) as { code?: string; message?: string; errors?: Record<string, string> };
    const retry = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, e.code ?? "error", e.message ?? "Request failed.", e.errors, Number.isFinite(retry) ? retry : undefined, json);
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

// ---- notifications (M5; API docs "Notifications") ----
export interface NotificationItem { id: string; kind: string; category: string; orderNumber: string | null; sellerOrderNumber: string | null; parameters: Record<string, unknown> | null; createdAt: string; read: boolean }
export interface NotificationList { unreadCount: number; notifications: NotificationItem[]; next: { before: string; beforeId: string } | null }
export type NotificationPrefs = { email: Record<string, boolean> };

// ---- messages (M5; API docs "Messages") ----
export interface ThreadSummary { id: string; kind: string; subject: string; sellerName: string | null; orderNumber: string | null; listingId: string | null; lastMessageAt: string; unreadCount: number; preview: string }
export interface ThreadList { unreadCount: number; threads: ThreadSummary[]; next: { before: string; beforeId: string } | null }
export interface MessageAttachmentView { id: string; fileName: string; size: number; type: string | null; available: boolean }
export interface ThreadMessageView { id: string; direction: "buyer" | "seller"; status: string; sentAt: string; read: boolean; reported: boolean; hidden: boolean; text: string | null; attachments: MessageAttachmentView[] }
export interface ThreadView { thread: { id: string; kind: string; subject: string; sellerName: string | null; listingId: string | null }; messages: ThreadMessageView[]; older: string | null }
export interface SendMessageInput { threadId?: string; orderNumber?: string; sellerOrderNumber?: string; listingId?: string; text: string; acknowledgeWarning?: boolean }

/** Raw GET for binary answers (proof images, message files): the caller streams it to the browser with its own safe headers. */
async function raw(ctx: ApiRequestContext, path: string): Promise<Response> {
  try { return await apiFetch(getConfig(), ctx, path, { signal: AbortSignal.timeout(20000) }); } catch { throw new ApiError(503, "unavailable", "The service is temporarily unavailable. Please try again."); }
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
  providers: { providerId: string; displayName: string }[]; assignment?: string; policy?: Record<string, number | null>;
}
export interface BookingPayment { provider: string; clientSecret: string; publishableKey: string | null }
export interface HoldBody { listingId: string; start: string; location: string; durationMinutes?: number; providerId?: string; addOnIds?: string[]; phone?: string; address?: Record<string, string> }
export interface CancelPreview { feeKnown: boolean; feeCents?: number; refundCents?: number; totalCents: number; withinFreeWindow: boolean; freeUntil?: string; currency: string }
const guestOrderHeader = (token?: string): Record<string, string> | undefined => (token ? { [GUEST_ORDER_HEADER]: token } : undefined);

export const api = {
  /** Public: available times (the BFF forwards only the allow-listed query). */
  serviceAvailability: (ctx: ApiRequestContext, listingId: string, query: string) => call<Availability>(ctx, `/api/v1/services/${pid(listingId)}/availability?${query}`),
  serviceOptions: (ctx: ApiRequestContext, listingId: string) => call<ServiceOptions>(ctx, `/api/v1/services/${pid(listingId)}/options`),
  holdBooking: (ctx: ApiRequestContext, b: HoldBody, key: string) => call<BookingView>(ctx, "/api/v1/bookings/holds", b, undefined, { "Idempotency-Key": key }),
  bookings: (ctx: ApiRequestContext) => call<{ bookings: BookingView[] }>(ctx, "/api/v1/bookings"),
  booking: (ctx: ApiRequestContext, id: string) => call<BookingView>(ctx, `/api/v1/bookings/${pid(id)}`),
  checkoutBooking: (ctx: ApiRequestContext, id: string, b: { intake?: { id: string; answer: string }[]; phone?: string }) => call<{ booking: BookingView; payment: BookingPayment }>(ctx, `/api/v1/bookings/${pid(id)}/checkout`, b),
  cancelBookingPreview: (ctx: ApiRequestContext, id: string) => call<CancelPreview>(ctx, `/api/v1/bookings/${pid(id)}/cancel-preview`),
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
  reauthenticate: (ctx: ApiRequestContext, password: string) => call<void>(ctx, "/api/v1/auth/reauthenticate", { password }),
  signIn: (ctx: ApiRequestContext, b: { email: string; password: string }) => call<{ token: string; user: ApiUser }>(ctx, "/api/v1/auth/sign-in", b),
  signOut: (ctx: ApiRequestContext) => call<void>(ctx, "/api/v1/auth/sign-out", {}),
  signOutAll: (ctx: ApiRequestContext) => call<void>(ctx, "/api/v1/auth/sign-out-all", {}),
  forgotPassword: (ctx: ApiRequestContext, email: string) => call<void>(ctx, "/api/v1/auth/forgot-password", { email }),
  resetPassword: (ctx: ApiRequestContext, b: { token: string; password: string }) => call<void>(ctx, "/api/v1/auth/reset-password", b),
  me: (ctx: ApiRequestContext) => call<ApiUser>(ctx, "/api/v1/account/me"),
  profile: (ctx: ApiRequestContext) => call<Profile>(ctx, "/api/v1/account/profile"),
  updateProfile: (ctx: ApiRequestContext, b: { displayName: string; phone: string }) => call<Profile>(ctx, "/api/v1/account/profile", b, "PUT"),
  addresses: (ctx: ApiRequestContext) => call<Address[]>(ctx, "/api/v1/account/addresses"),
  address: (ctx: ApiRequestContext, id: string) => call<Address>(ctx, `/api/v1/account/addresses/${pid(id)}`),
  createAddress: (ctx: ApiRequestContext, b: AddressBody) => call<Address>(ctx, "/api/v1/account/addresses", b),
  updateAddress: (ctx: ApiRequestContext, id: string, b: AddressBody) => call<Address>(ctx, `/api/v1/account/addresses/${pid(id)}`, b, "PUT"),
  deleteAddress: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/account/addresses/${pid(id)}`, undefined, "DELETE"),
  setDefaultAddress: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/account/addresses/${pid(id)}/default`, {}),
  passkeys: (ctx: ApiRequestContext) => call<PasskeyInfo[]>(ctx, "/api/v1/account/passkeys"),
  passkeyRegistrationOptions: (ctx: ApiRequestContext) => call<PasskeyChallenge>(ctx, "/api/v1/account/passkeys/options", {}),
  registerPasskey: (ctx: ApiRequestContext, b: { challengeId: string; name: string; credential: unknown }) => call<PasskeyInfo>(ctx, "/api/v1/account/passkeys", b),
  deletePasskey: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/account/passkeys/${pid(id)}`, undefined, "DELETE"),
  passkeySignInOptions: (ctx: ApiRequestContext) => call<PasskeyChallenge>(ctx, "/api/v1/auth/passkey/options", {}),
  passkeySignIn: (ctx: ApiRequestContext, b: { challengeId: string; credential: unknown }) => call<{ token: string; user: ApiUser }>(ctx, "/api/v1/auth/passkey/sign-in", b),
  // Demo data (404 from the API while its Demo:Enabled is off).
  demoStatus: (ctx: ApiRequestContext) => call<DemoStatus>(ctx, "/api/v1/demo/status"),
  demoFill: (ctx: ApiRequestContext) => call<DemoFill>(ctx, "/api/v1/demo/fill", {}),
  demoRemove: (ctx: ApiRequestContext) => call<{ removed: DemoCounts }>(ctx, "/api/v1/demo/remove", {}),
  /** Test-only: marks an unverified account verified. Takes the credentials because an unverified account has no session. */
  demoVerify: (ctx: ApiRequestContext, b: { email: string; password: string }) => call<void>(ctx, "/api/v1/demo/verify", b),
};
