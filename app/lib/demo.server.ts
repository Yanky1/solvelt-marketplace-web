import { apiFetch, type ApiRequestContext } from "./api.server";
import { getConfig } from "./config.server";

/**
 * Test mode (M9). Two switches must agree before anything but the badge shows: the API's public config says `demoEnabled` (the badge: "this marketplace is in test
 * mode") and this server's own DEMO_ENABLED is on (the buttons). Either alone shows no button. The answer is cached for a short time so a page never waits on it,
 * and an API that does not answer, or answers anything unexpected, means "off": test mode never switches on by accident.
 */
export interface DemoMode { badge: boolean; buttons: boolean }

const TTL_MS = 30_000, FAIL_TTL_MS = 10_000, TIMEOUT_MS = 1500;
let cache: { at: number; ttl: number; value: boolean } | null = null;

export function resetDemoModeCache(): void { cache = null; warnedAt = Number.NEGATIVE_INFINITY; }

export function parsePublicConfig(json: unknown): boolean {
  return typeof json === "object" && json !== null && (json as { demoEnabled?: unknown }).demoEnabled === true;
}

async function apiSaysDemo(ctx: ApiRequestContext, now: number): Promise<boolean> {
  if (cache && now - cache.at < cache.ttl) return cache.value;
  let value = false, ttl = FAIL_TTL_MS;
  try {
    const res = await apiFetch(getConfig(), ctx, "/api/v1/config", { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) { value = parsePublicConfig(await res.json()); ttl = TTL_MS; }
  } catch { /* an unreachable API is "off" for a few seconds, not an error page */ }
  cache = { at: now, ttl, value };
  return value;
}

let warnedAt = Number.NEGATIVE_INFINITY;

export async function demoMode(ctx: ApiRequestContext, now = Date.now()): Promise<DemoMode> {
  const api = await apiSaysDemo(ctx, now);
  // A deployment that is not on the allowlist (production above all) shows no test-mode UI at all, not even the badge, whatever the API says (LOW-2): an API that is in test mode
  // behind a production web site is a misconfiguration to be seen in the log, not advertised on the page. One line a minute.
  if (api && !getConfig().demoAllowed) {
    if (now - warnedAt >= 60_000) { warnedAt = now; console.warn(JSON.stringify({ event: "demo_mode_hidden", reason: "api_says_test_mode_but_this_deployment_is_not_allowed" })); }
    return { badge: false, buttons: false };
  }
  return { badge: api, buttons: api && getConfig().demoEnabled };
}
