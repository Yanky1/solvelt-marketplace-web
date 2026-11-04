import { apiFetch, type ApiRequestContext } from "./api.server";
import { getConfig } from "./config.server";

/**
 * Typed client for the buyer API. ASSUMED CONTRACT (docs/DESIGN.md W1-21): the API's auth endpoints are not
 * documented yet; shapes here are what the mock API in e2e/mock-api.mjs implements, to be confirmed by M1.
 */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors?: Record<string, string>, public retryAfter?: number) {
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

async function call<T>(ctx: ApiRequestContext, path: string, body?: unknown, method?: string): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(getConfig(), ctx, path, { ...(body !== undefined ? { body } : {}), ...(method ? { method } : {}), signal: AbortSignal.timeout(8000) });
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
    throw new ApiError(res.status, e.code ?? "error", e.message ?? "Request failed.", e.errors, Number.isFinite(retry) ? retry : undefined);
  }
  return json as T;
}

export const api = {
  signUp: (ctx: ApiRequestContext, b: { email: string; password: string; displayName: string }) => call<void>(ctx, "/api/v1/auth/sign-up", b),
  resendVerification: (ctx: ApiRequestContext, email: string) => call<void>(ctx, "/api/v1/auth/resend-verification", { email }),
  verifyEmail: (ctx: ApiRequestContext, token: string) => call<void>(ctx, "/api/v1/auth/verify-email", { token }),
  signIn: (ctx: ApiRequestContext, b: { email: string; password: string }) => call<{ token: string; user: ApiUser }>(ctx, "/api/v1/auth/sign-in", b),
  signOut: (ctx: ApiRequestContext) => call<void>(ctx, "/api/v1/auth/sign-out", {}),
  signOutAll: (ctx: ApiRequestContext) => call<void>(ctx, "/api/v1/auth/sign-out-all", {}),
  forgotPassword: (ctx: ApiRequestContext, email: string) => call<void>(ctx, "/api/v1/auth/forgot-password", { email }),
  resetPassword: (ctx: ApiRequestContext, b: { token: string; password: string }) => call<void>(ctx, "/api/v1/auth/reset-password", b),
  me: (ctx: ApiRequestContext) => call<ApiUser>(ctx, "/api/v1/account/me"),
  profile: (ctx: ApiRequestContext) => call<Profile>(ctx, "/api/v1/account/profile"),
  updateProfile: (ctx: ApiRequestContext, b: { displayName: string; phone: string }) => call<Profile>(ctx, "/api/v1/account/profile", b, "PUT"),
  addresses: (ctx: ApiRequestContext) => call<Address[]>(ctx, "/api/v1/account/addresses"),
  address: (ctx: ApiRequestContext, id: string) => call<Address>(ctx, `/api/v1/account/addresses/${encodeURIComponent(id)}`),
  createAddress: (ctx: ApiRequestContext, b: AddressBody) => call<Address>(ctx, "/api/v1/account/addresses", b),
  updateAddress: (ctx: ApiRequestContext, id: string, b: AddressBody) => call<Address>(ctx, `/api/v1/account/addresses/${encodeURIComponent(id)}`, b, "PUT"),
  deleteAddress: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/account/addresses/${encodeURIComponent(id)}`, undefined, "DELETE"),
  setDefaultAddress: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/account/addresses/${encodeURIComponent(id)}/default`, {}),
  passkeys: (ctx: ApiRequestContext) => call<PasskeyInfo[]>(ctx, "/api/v1/account/passkeys"),
  passkeyRegistrationOptions: (ctx: ApiRequestContext) => call<PasskeyChallenge>(ctx, "/api/v1/account/passkeys/options", {}),
  registerPasskey: (ctx: ApiRequestContext, b: { challengeId: string; name: string; credential: unknown }) => call<PasskeyInfo>(ctx, "/api/v1/account/passkeys", b),
  deletePasskey: (ctx: ApiRequestContext, id: string) => call<void>(ctx, `/api/v1/account/passkeys/${encodeURIComponent(id)}`, undefined, "DELETE"),
  passkeySignInOptions: (ctx: ApiRequestContext) => call<PasskeyChallenge>(ctx, "/api/v1/auth/passkey/options", {}),
  passkeySignIn: (ctx: ApiRequestContext, b: { challengeId: string; credential: unknown }) => call<{ token: string; user: ApiUser }>(ctx, "/api/v1/auth/passkey/sign-in", b),
};
