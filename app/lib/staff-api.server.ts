import { ApiError } from "./api-client.server";
import { apiFetch, type ApiRequestContext } from "./api.server";
import { getConfig } from "./config.server";
import { isSafeId } from "./passkey.server";

/** Typed client for the marketplace API's staff endpoints (API repo docs/API.md "Staff", docs/STAFF.md). Money is always `long` cents. */

export interface StaffMe { id: string; email: string; displayName: string; role: "support" | "finance" | "admin"; permissions: string[]; stepUpUntil: string | null }
export interface StaffBuyer {
  id: string; email: string | null; name: string; relayEmail: string; emailVerified: boolean; locked: boolean; lockedAt: string | null; deleted: boolean; redacted: boolean; createdAt: string;
  passkeys: number; activeSessions: number; addresses: number; orders: number; hasPassword: boolean; demo: boolean;
}
export interface StaffRevealed { email: string | null; name: string | null; phone: string | null; addresses: { name: string; line1: string; line2: string | null; city: string; region: string | null; postalCode: string; country: string; phone: string | null }[] | null; redacted: boolean }
export interface StaffRefund { id: string; amountCents: number; status: string; reason: string; attempt: number; createdAt: string; updatedAt: string; retryable: boolean }
export interface StaffOrder {
  id: string; number: string; status: string; createdAt: string; paidAt: string | null; placedAt: string | null; failureCode: string | null; currency: string; demo: boolean;
  itemsCents: number; shippingCents: number; taxCents: number; totalCents: number; paidCents: number; refundedCents: number;
  buyer: { accountId: string | null; name: string; guestEmail: string | null; relayEmail: string; shipCountry: string };
  lines: number; groups: { id: string; sellerOrderNumber: string | null; totalCents: number; refundedCents: number }[]; refunds: StaffRefund[];
  payment: null | { paymentIntentId: string | null; disputes: { disputeId: string | null; lastEventType: string; closed: boolean }[]; refunds: { id: string; stripeRefundId: string | null; portalRefundId: string | null; key: string }[] };
}
export interface StaffBuyerOrder { id: string; number: string; status: string; createdAt: string; totalCents: number; refundedCents: number; demo: boolean }
export interface StaffIngest { id: string; number: string; paidAt: string; totalCents: number; demo: boolean; message: null | { status: string; attempts: number; lastError: string | null; nextAttemptAt: string }; retryable: boolean }
export interface StaffOutboxMessage { id: string; type: string; status: string; attempts: number; nextAttemptAt: string; lastError: string | null; createdAt: string; deliveredAt: string | null; deadAt: string | null; retryable: boolean }
export interface StaffOutbox { counts: { pending: number; delivered: number; dead: number }; messages: StaffOutboxMessage[]; next: string | null }
export interface StaffParked { id: string; type: string; aggregateType: string | null; aggregateKey: string | null; receivedAt: string; ageHours: number; lastReplayAt: string | null; note: string | null; retryable: boolean }
export interface StaffBookingConfirm {
  messageId: string; lastError: string | null; attempts: number; deadAt: string | null; bookingId: string | null; bookingNumber: string | null; bookingStatus: string | null; demo: boolean;
  paymentId: string | null; paymentStatus: string | null; currency: string | null; amountCents: number | null; capturedCents: number | null; refundedCents: number | null; needsPerson: boolean; retryable: boolean; steps: string[];
}
export interface StaffStripeEvent { id: string; type: string; outcome: string; objectId: string | null; receivedAt: string }
export interface StaffAccount { id: string; email: string; displayName: string; role: string; enrolled: boolean; disabled: boolean; passkeys: number; createdAt: string; lastSignInAt: string | null }
export interface StaffAuditEntry { id: string; at: string; actorId: string | null; actorRole: string; action: string; targetType: string | null; targetId: string | null; reason: string; detail: string | null }
export interface StaffPasskeyChallenge { challengeId: string; options: Record<string, unknown> }

interface CallOpts { method?: string; body?: unknown }

async function call<T>(ctx: ApiRequestContext, path: string, opts: CallOpts = {}): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(getConfig(), ctx, `/api/v1/staff${path}`, { ...(opts.body !== undefined ? { body: opts.body } : {}), ...(opts.method ? { method: opts.method } : {}), signal: AbortSignal.timeout(10_000) });
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

/** Ids end up in API paths: only ids shaped like ours get there (".." would be normalised onto another route). */
const id = (v: string): string => { if (!isSafeId(v) && !/^[0-9a-fA-F-]{36}$/.test(v)) throw new ApiError(404, "not_found", "Not found"); return encodeURIComponent(v); };
const qs = (o: Record<string, string | number | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const staffApi = {
  // ---- sign-in, enrolment, step-up
  signInOptions: (ctx: ApiRequestContext) => call<StaffPasskeyChallenge>(ctx, "/auth/passkey/options", { method: "POST", body: {} }),
  signIn: (ctx: ApiRequestContext, challengeId: string, credential: unknown) => call<{ token: string }>(ctx, "/auth/passkey/sign-in", { body: { challengeId, credential } }),
  enrolOptions: (ctx: ApiRequestContext, token: string) => call<StaffPasskeyChallenge>(ctx, "/auth/enrol/options", { body: { token } }),
  enrol: (ctx: ApiRequestContext, body: { token: string; challengeId: string; name: string; credential: unknown }) => call<{ token: string }>(ctx, "/auth/enrol", { body }),
  reauthOptions: (ctx: ApiRequestContext) => call<StaffPasskeyChallenge>(ctx, "/auth/reauthenticate/options", { method: "POST", body: {} }),
  reauth: (ctx: ApiRequestContext, challengeId: string, credential: unknown) => call<void>(ctx, "/auth/reauthenticate", { body: { challengeId, credential } }),
  signOut: (ctx: ApiRequestContext) => call<void>(ctx, "/auth/sign-out", { method: "POST", body: {} }),
  me: (ctx: ApiRequestContext) => call<StaffMe>(ctx, "/me"),
  // ---- buyers
  // lookups are POSTs with a body: what was typed and the reason must never travel in a URL (API decision M7-17)
  findBuyer: (ctx: ApiRequestContext, key: "email" | "order" | "id", value: string, reason: string) => call<StaffBuyer>(ctx, "/buyers/lookup", { body: { [key]: value, reason } }),
  reveal: (ctx: ApiRequestContext, buyerId: string, fields: string[], reason: string) => call<StaffRevealed>(ctx, `/buyers/${id(buyerId)}/reveal`, { body: { fields, reason } }),
  lock: (ctx: ApiRequestContext, buyerId: string, locked: boolean, reason: string) => call<void>(ctx, `/buyers/${id(buyerId)}/${locked ? "lock" : "unlock"}`, { body: { reason } }),
  signOutBuyer: (ctx: ApiRequestContext, buyerId: string, reason: string) => call<void>(ctx, `/buyers/${id(buyerId)}/sign-out`, { body: { reason } }),
  buyerOrders: (ctx: ApiRequestContext, buyerId: string, reason: string) => call<StaffBuyerOrder[]>(ctx, `/buyers/${id(buyerId)}/orders`, { body: { reason } }),
  // ---- orders and payments
  findOrder: (ctx: ApiRequestContext, number: string, reason: string) => call<StaffOrder>(ctx, "/orders/lookup", { body: { number, reason } }),
  retryRefund: (ctx: ApiRequestContext, orderId: string, refundId: string, reason: string) => call<void>(ctx, `/orders/${id(orderId)}/refunds/${id(refundId)}/retry`, { body: { reason } }),
  // ---- queues
  ingests: (ctx: ApiRequestContext) => call<{ stuckAfterMinutes: number; orders: StaffIngest[] }>(ctx, "/ingests"),
  retryIngest: (ctx: ApiRequestContext, orderId: string, reason: string) => call<void>(ctx, `/ingests/${id(orderId)}/retry`, { body: { reason } }),
  outbox: (ctx: ApiRequestContext, q: { status?: string; type?: string; before?: string }) => call<StaffOutbox>(ctx, `/outbox${qs({ ...q, limit: 50 })}`),
  retryOutbox: (ctx: ApiRequestContext, messageId: string, reason: string) => call<void>(ctx, `/outbox/${id(messageId)}/retry`, { body: { reason } }),
  deadLetters: (ctx: ApiRequestContext) => call<{ counts: Record<string, number>; parked: StaffParked[]; bookingConfirms: StaffBookingConfirm[] }>(ctx, "/dead-letters"),
  retryDeadLetter: (ctx: ApiRequestContext, eventId: string, reason: string) => call<{ replayed: number }>(ctx, "/dead-letters/retry", { body: { eventId, reason } }),
  stripeFailures: (ctx: ApiRequestContext, before?: string) => call<{ total: number; events: StaffStripeEvent[]; next: string | null }>(ctx, `/stripe/failures${qs({ before, limit: 50 })}`),
  // ---- staff accounts and audit (admin)
  accounts: (ctx: ApiRequestContext) => call<StaffAccount[]>(ctx, "/accounts"),
  createAccount: (ctx: ApiRequestContext, body: { email: string; displayName: string; role: string; reason: string }) => call<{ account: StaffAccount; enrolmentToken: string; expiresAt: string }>(ctx, "/accounts", { body }),
  reissue: (ctx: ApiRequestContext, staffId: string, revokePasskeys: boolean, reason: string) => call<{ enrolmentToken: string; expiresAt: string }>(ctx, `/accounts/${id(staffId)}/enrolment`, { body: { reason, revokePasskeys } }),
  setRole: (ctx: ApiRequestContext, staffId: string, role: string, reason: string) => call<void>(ctx, `/accounts/${id(staffId)}/role`, { body: { role, reason } }),
  setDisabled: (ctx: ApiRequestContext, staffId: string, disabled: boolean, reason: string) => call<void>(ctx, `/accounts/${id(staffId)}/${disabled ? "disable" : "enable"}`, { body: { reason } }),
  signOutStaff: (ctx: ApiRequestContext, staffId: string, reason: string) => call<void>(ctx, `/accounts/${id(staffId)}/sign-out`, { body: { reason } }),
  audit: (ctx: ApiRequestContext, q: { action?: string; actor?: string; before?: string }) => call<{ entries: StaffAuditEntry[]; next: string | null }>(ctx, `/audit${qs({ ...q, limit: 50 })}`),
};
