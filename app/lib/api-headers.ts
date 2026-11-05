/**
 * The request headers of the marketplace API that this site sets itself. The NAMES are the API's contract (its CartEndpoints.GuestHeader and CheckoutEndpoints.GuestOrderHeader): a wrong name
 * is not an error anywhere, the API just sees no owner, so guest carts and guest checkout would silently stop working while a mock that copied the wrong name stays green (review H1).
 * `api-headers.test.ts` pins the literals, and the E2E mock answers ONLY these names.
 */
export const CART_TOKEN_HEADER = "X-Solvelt-Cart-Token";
export const GUEST_ORDER_HEADER = "X-Guest-Order";
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** The only extra request headers a route may hand to apiFetch (everything else is dropped). */
export const ALLOWED_API_HEADERS: ReadonlySet<string> = new Set([CART_TOKEN_HEADER, GUEST_ORDER_HEADER, IDEMPOTENCY_HEADER].map((h) => h.toLowerCase()));
