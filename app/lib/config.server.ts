import { parseTrustedProxies } from "./client-ip.server";

export interface AppConfig {
  apiBaseUrl: string;
  sessionCookieSecret: string;
  publicOrigin: string;
  /** IPs/IPv4 CIDRs of our own reverse proxies; X-Forwarded-For is honoured only from these. */
  trustedProxies: string[];
  /** Shared with the API (Web__ForwardingKey): signs the forwarded client IP. Distinct from the session secret. */
  webForwardingKey: string;
  /** How recent a sign-in must be to remove a passkey or change a sign-in method (seconds). */
  reauthWindowSeconds: number;
  /** Stripe.js (decision M3W-06). Only the checkout page loads it. */
  stripeJsUrl: string;
  production: boolean;
}

const DEV_SECRET = "dev-only-secret-dev-only-secret-0000";
export const DEV_FORWARDING_KEY = "dev-only-web-forwarding-key-not-for-production";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Anything except an explicit development/test run is treated as production (NODE_ENV unset included). */
export function isProduction(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV !== "development" && env.NODE_ENV !== "test";
}

/** Why a secret is too weak, or null. Never includes the secret itself. */
export function weakSecretReason(value: string): string | null {
  if (value.length < 32) return "must be at least 32 characters";
  if (/change[-_ ]?me|placeholder|example|replace[-_ ]?me|secret[-_]?secret|^dev-only/i.test(value)) return "looks like a placeholder or development value";
  if (new Set(value).size < 12) return "has too little variety (use random characters, e.g. `openssl rand -base64 48`)";
  return null;
}

function hostnameOf(origin: string): string | null {
  try { return new URL(origin).hostname; } catch { return null; }
}

/** Pure validation, exported for tests. Throws listing every problem (never the secret values). */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const production = isProduction(env);
  const problems: string[] = [];
  const apiBaseUrl = (env.API_BASE_URL ?? (production ? "" : "http://localhost:5080")).replace(/\/+$/, "");
  const publicOrigin = (env.PUBLIC_ORIGIN ?? (production ? "" : "http://localhost:3000")).replace(/\/+$/, "");
  const secret = env.SESSION_COOKIE_SECRET ?? (production ? "" : DEV_SECRET);
  const fwdKey = env.WEB_FORWARDING_KEY ?? (production ? "" : DEV_FORWARDING_KEY);

  if (!secret) problems.push("SESSION_COOKIE_SECRET is required");
  else if (production) { const r = weakSecretReason(secret); if (r) problems.push(`SESSION_COOKIE_SECRET ${r}`); }
  else if (secret.length < 32) problems.push("SESSION_COOKIE_SECRET must be at least 32 characters");

  if (!fwdKey) problems.push("WEB_FORWARDING_KEY is required");
  else if (production) { const r = weakSecretReason(fwdKey); if (r) problems.push(`WEB_FORWARDING_KEY ${r}`); }
  else if (fwdKey.length < 32) problems.push("WEB_FORWARDING_KEY must be at least 32 characters");
  if (secret && fwdKey && fwdKey === secret) problems.push("WEB_FORWARDING_KEY must differ from SESSION_COOKIE_SECRET");

  if (!apiBaseUrl) problems.push("API_BASE_URL is required");
  else if (!/^https?:\/\//.test(apiBaseUrl)) problems.push("API_BASE_URL must be an http(s) URL");

  if (!publicOrigin) problems.push("PUBLIC_ORIGIN is required");
  else if (!/^https?:\/\/[^/]+$/.test(publicOrigin)) problems.push("PUBLIC_ORIGIN must be an origin (scheme://host[:port])");
  else if (production && publicOrigin.startsWith("http://") && !LOCAL_HOSTS.has(hostnameOf(publicOrigin) ?? "")) {
    problems.push("PUBLIC_ORIGIN must be https in production (http is allowed only for localhost or 127.0.0.1)");
  }

  const trustedProxies = (env.TRUSTED_PROXIES ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  try { parseTrustedProxies(trustedProxies); } catch (e) { problems.push((e as Error).message); }

  const reauthRaw = env.REAUTH_WINDOW_SECONDS;
  const reauthWindowSeconds = reauthRaw === undefined || reauthRaw === "" ? 600 : /^[0-9]{1,4}$/.test(reauthRaw) ? Number(reauthRaw) : NaN;
  if (!Number.isInteger(reauthWindowSeconds) || reauthWindowSeconds < 1 || reauthWindowSeconds > 3600) problems.push("REAUTH_WINDOW_SECONDS must be a whole number of seconds between 1 and 3600");

  const stripeJsUrl = env.STRIPE_JS_URL?.trim() || "https://js.stripe.com/v3";
  try {
    const u = new URL(stripeJsUrl);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname)) ) problems.push("STRIPE_JS_URL must be https (http only for localhost)");
    // Production loads Stripe.js from Stripe's own origin only. The ONE exception is the E2E run: it must say so with ALLOW_STRIPE_STUB=1 AND be served from localhost (review L1).
    const stubAllowed = env.ALLOW_STRIPE_STUB === "1" && LOCAL_HOSTS.has(hostnameOf(publicOrigin) ?? "");
    if (production && u.origin !== "https://js.stripe.com" && !stubAllowed) problems.push("STRIPE_JS_URL must be https://js.stripe.com/... in production");
  } catch { problems.push("STRIPE_JS_URL must be a URL"); }

  if (problems.length) throw new Error(`Invalid configuration: ${problems.join("; ")}`);
  return { apiBaseUrl, sessionCookieSecret: secret, publicOrigin, trustedProxies, webForwardingKey: fwdKey, reauthWindowSeconds, stripeJsUrl, production };
}

/** The origins the checkout page may load Stripe.js from (script-src and frame-src): Stripe's own, plus the configured one when it differs (only possible for the E2E stand-in, see loadConfig). */
export const stripeScriptOrigins = (stripeJsUrl: string): string[] => [...new Set(["https://js.stripe.com", new URL(stripeJsUrl).origin])];

let cached: AppConfig | undefined;
export function getConfig(): AppConfig {
  return (cached ??= loadConfig(process.env));
}
