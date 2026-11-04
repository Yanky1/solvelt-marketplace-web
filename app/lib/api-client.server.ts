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
  verifyEmail: (ctx: ApiRequestContext, token: string) => call<void>(ctx, "/api/v1/auth/verify-email", { token }),
  signIn: (ctx: ApiRequestContext, b: { email: string; password: string }) => call<{ token: string; user: ApiUser }>(ctx, "/api/v1/auth/sign-in", b),
  signOut: (ctx: ApiRequestContext) => call<void>(ctx, "/api/v1/auth/sign-out", {}),
  signOutAll: (ctx: ApiRequestContext) => call<void>(ctx, "/api/v1/auth/sign-out-all", {}),
  forgotPassword: (ctx: ApiRequestContext, email: string) => call<void>(ctx, "/api/v1/auth/forgot-password", { email }),
  resetPassword: (ctx: ApiRequestContext, b: { token: string; password: string }) => call<void>(ctx, "/api/v1/auth/reset-password", b),
  me: (ctx: ApiRequestContext) => call<ApiUser>(ctx, "/api/v1/account/me"),
};
