import { afterEach, describe, expect, it, vi } from "vitest";

/** Decision M8W-06: /healthz says which build runs (a commit sha), so "is the fix deployed?" can be answered from a browser. Only a plain hex sha is ever shown. */
async function health() {
  vi.resetModules();
  const { loader } = await import("./healthz");
  return (await loader()).json() as Promise<Record<string, unknown>>;
}
afterEach(() => { vi.unstubAllEnvs(); });

describe("/healthz", () => {
  it("is ok without a commit when none is configured", async () => {
    vi.stubEnv("GIT_COMMIT_SHA", ""); vi.stubEnv("SOURCE_VERSION", ""); vi.stubEnv("GITHUB_SHA", "");
    expect(await health()).toEqual({ status: "ok" });
  });
  it("shows the commit from GIT_COMMIT_SHA, then SOURCE_VERSION, then GITHUB_SHA", async () => {
    vi.stubEnv("GIT_COMMIT_SHA", "0609e5e62b5ede6ec72b1e6941dd103fe6d0b14b"); vi.stubEnv("SOURCE_VERSION", "aaaaaaa");
    expect(await health()).toEqual({ status: "ok", commit: "0609e5e62b5ede6ec72b1e6941dd103fe6d0b14b" });
    vi.stubEnv("GIT_COMMIT_SHA", ""); expect(await health()).toEqual({ status: "ok", commit: "aaaaaaa" });
  });
  it("never shows a value that is not a plain hex sha", async () => {
    vi.stubEnv("GIT_COMMIT_SHA", "main; DROP TABLE"); vi.stubEnv("SOURCE_VERSION", ""); vi.stubEnv("GITHUB_SHA", "");
    expect(await health()).toEqual({ status: "ok" });
  });
});
