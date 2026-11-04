export interface AppConfig {
  apiBaseUrl: string;
  sessionCookieSecret: string;
  publicOrigin: string;
  /** IPs/IPv4 CIDRs of our own reverse proxies; X-Forwarded-For is honoured only from these. */
  trustedProxies: string[];
  /** Shared with the API (Web__ForwardingKey): signs the forwarded client IP. Distinct from the session secret. */
  webForwardingKey: string;
  production: boolean;
}

const DEV_SECRET = "dev-only-secret-dev-only-secret-0000";
export const DEV_FORWARDING_KEY = "dev-only-web-forwarding-key-not-for-production";

/** Pure validation, exported for tests. Throws listing every problem (never the secret values). */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const production = env.NODE_ENV === "production";
  const problems: string[] = [];
  const apiBaseUrl = (env.API_BASE_URL ?? (production ? "" : "http://localhost:5080")).replace(/\/+$/, "");
  const publicOrigin = (env.PUBLIC_ORIGIN ?? (production ? "" : "http://localhost:3000")).replace(/\/+$/, "");
  const secret = env.SESSION_COOKIE_SECRET ?? (production ? "" : DEV_SECRET);

  const fwdKey = env.WEB_FORWARDING_KEY ?? (production ? "" : DEV_FORWARDING_KEY);
  if (!fwdKey) problems.push("WEB_FORWARDING_KEY is required");
  else if (fwdKey.length < 32) problems.push("WEB_FORWARDING_KEY must be at least 32 characters");
  else if (production && fwdKey === DEV_FORWARDING_KEY) problems.push("WEB_FORWARDING_KEY must not be the development default");
  else if (fwdKey === secret) problems.push("WEB_FORWARDING_KEY must differ from SESSION_COOKIE_SECRET");

  if (!apiBaseUrl) problems.push("API_BASE_URL is required");
  else if (!/^https?:\/\//.test(apiBaseUrl)) problems.push("API_BASE_URL must be an http(s) URL");
  if (!publicOrigin) problems.push("PUBLIC_ORIGIN is required");
  else if (!/^https?:\/\/[^/]+$/.test(publicOrigin)) problems.push("PUBLIC_ORIGIN must be an origin (scheme://host[:port])");
  if (!secret) problems.push("SESSION_COOKIE_SECRET is required");
  else if (secret.length < 32) problems.push("SESSION_COOKIE_SECRET must be at least 32 characters");
  else if (production && secret === DEV_SECRET) problems.push("SESSION_COOKIE_SECRET must not be the development default");
  if (production && publicOrigin.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(publicOrigin)) {
    problems.push("PUBLIC_ORIGIN must be https in production");
  }

  if (problems.length) throw new Error(`Invalid configuration: ${problems.join("; ")}`);
  const trustedProxies = (env.TRUSTED_PROXIES ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return { apiBaseUrl, sessionCookieSecret: secret, publicOrigin, trustedProxies, webForwardingKey: fwdKey, production };
}

let cached: AppConfig | undefined;
export function getConfig(): AppConfig {
  return (cached ??= loadConfig(process.env));
}
