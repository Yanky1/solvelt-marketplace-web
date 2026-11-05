import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoMode, parsePublicConfig, resetDemoModeCache } from "./demo.server";

const ctx = { request: new Request("http://localhost/"), socketAddress: "127.0.0.1" } as never;
const config = (demoEnabled: boolean) => ({ apiBaseUrl: "http://api.test", trustedProxies: [], webForwardingKey: "k".repeat(40), production: false, demoEnabled, demoAllowed: true });

vi.mock("./config.server", () => ({ getConfig: vi.fn() }));
vi.mock("./api.server", () => ({ apiFetch: vi.fn() }));
import { getConfig } from "./config.server";
import { apiFetch } from "./api.server";

// a fresh Response per call: a body can be read only once
const answer = (body: unknown, status = 200) => vi.mocked(apiFetch).mockImplementation(async () => new Response(JSON.stringify(body), { status }));

describe("parsePublicConfig", () => {
  it("is on only for a real boolean true", () => {
    expect(parsePublicConfig({ demoEnabled: true })).toBe(true);
    for (const v of [false, undefined, "true", 1, null, [], {}]) expect(parsePublicConfig({ demoEnabled: v }), String(v)).toBe(false);
    for (const v of [null, undefined, "x", 3, [true]]) expect(parsePublicConfig(v), String(v)).toBe(false);
  });
});

describe("demoMode", () => {
  beforeEach(() => { resetDemoModeCache(); vi.mocked(getConfig).mockReturnValue(config(true) as never); vi.mocked(apiFetch).mockReset(); });
  afterEach(() => vi.restoreAllMocks());

  it("shows the buttons only when the API and this server agree, and the badge when the API says so", async () => {
    answer({ demoEnabled: true });
    expect(await demoMode(ctx, 1000)).toEqual({ badge: true, buttons: true });
    resetDemoModeCache(); vi.mocked(getConfig).mockReturnValue(config(false) as never); answer({ demoEnabled: true });
    expect(await demoMode(ctx, 1000)).toEqual({ badge: true, buttons: false });          // the API is in test mode, this server did not agree: a badge, no buttons
    resetDemoModeCache(); vi.mocked(getConfig).mockReturnValue(config(true) as never); answer({ demoEnabled: false });
    expect(await demoMode(ctx, 1000)).toEqual({ badge: false, buttons: false });         // this server is on but the API is not: nothing
  });

  it("a deployment that is not allowed shows no test-mode UI at all, not even the badge, and says so in the log (LOW-2)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getConfig).mockReturnValue({ ...config(false), demoAllowed: false } as never);
    answer({ demoEnabled: true });
    expect(await demoMode(ctx, 1000)).toEqual({ badge: false, buttons: false });
    expect(await demoMode(ctx, 2000)).toEqual({ badge: false, buttons: false });
    expect(warn).toHaveBeenCalledTimes(1);                                                  // one line a minute, not one per page
    expect(String(warn.mock.calls[0]![0])).toContain("demo_mode_hidden");
    expect(await demoMode(ctx, 62_000)).toEqual({ badge: false, buttons: false });
    expect(warn).toHaveBeenCalledTimes(2);
    resetDemoModeCache(); answer({ demoEnabled: false });
    warn.mockClear();
    expect(await demoMode(ctx, 1000)).toEqual({ badge: false, buttons: false });
    expect(warn).not.toHaveBeenCalled();                                                    // nothing to warn about when the API is not in test mode
  });

  it("an API that fails, times out or answers nonsense means off, never an error", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("down"));
    expect(await demoMode(ctx, 1000)).toEqual({ badge: false, buttons: false });
    resetDemoModeCache(); answer({ demoEnabled: true }, 503);
    expect(await demoMode(ctx, 1000)).toEqual({ badge: false, buttons: false });
    resetDemoModeCache(); vi.mocked(apiFetch).mockImplementation(async () => new Response("not json", { status: 200 }));
    expect(await demoMode(ctx, 1000)).toEqual({ badge: false, buttons: false });
  });

  it("asks the API once per 30 seconds and a failure for 10, not on every page", async () => {
    answer({ demoEnabled: true });
    await demoMode(ctx, 1000); await demoMode(ctx, 20_000);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    await demoMode(ctx, 31_001);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    resetDemoModeCache(); vi.mocked(apiFetch).mockReset(); vi.mocked(apiFetch).mockRejectedValue(new Error("down"));
    await demoMode(ctx, 100_000); await demoMode(ctx, 105_000);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    await demoMode(ctx, 110_001);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
