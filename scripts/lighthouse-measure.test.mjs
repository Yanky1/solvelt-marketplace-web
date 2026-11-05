import { describe, expect, it, vi } from "vitest";
import { measureWithRetry, RETRYABLE_RUNTIME_ERRORS } from "./lighthouse-measure.mjs";

const ok = { categories: { seo: { score: 1 } }, audits: {} };
const broken = (code) => ({ runtimeError: { code, message: "x" } });
const sequence = (...lhrs) => { const m = vi.fn(); lhrs.forEach((lhr) => m.mockResolvedValueOnce({ lhr })); return m; };

describe("measureWithRetry", () => {
  it("measures once when the run worked", async () => {
    const m = sequence(ok);
    expect(await measureWithRetry(m)).toBe(ok);
    expect(m).toHaveBeenCalledTimes(1);
  });
  it("repeats a NO_NAVSTART measurement ONCE as a fresh run and returns the repeat", async () => {
    const note = vi.fn();
    const m = sequence(broken("NO_NAVSTART"), ok);
    expect(await measureWithRetry(m, note)).toBe(ok);
    expect(m).toHaveBeenCalledTimes(2);
    expect(note).toHaveBeenCalledTimes(1);
    expect(note.mock.calls[0][0]).toContain("NO_NAVSTART");
  });
  it("never repeats more than once: a second NO_NAVSTART is returned to fail the run", async () => {
    const second = broken("NO_NAVSTART");
    const m = sequence(broken("NO_NAVSTART"), second, ok);
    expect(await measureWithRetry(m)).toBe(second);
    expect(m).toHaveBeenCalledTimes(2);
  });
  it("never repeats any other runtime error", async () => {
    for (const code of ["PROTOCOL_TIMEOUT", "FAILED_DOCUMENT_REQUEST", "NO_FCP", "PAGE_HUNG"]) {
      const first = broken(code);
      const m = sequence(first, ok);
      expect(await measureWithRetry(m)).toBe(first);
      expect(m).toHaveBeenCalledTimes(1);
    }
  });
  it("never repeats a run that was measured, whatever its scores (a bad score is the page's)", async () => {
    const lowScore = { categories: { seo: { score: 0.4 } }, audits: { "cumulative-layout-shift": { numericValue: 0.9 } } };
    const m = sequence(lowScore, ok);
    expect(await measureWithRetry(m)).toBe(lowScore);
    expect(m).toHaveBeenCalledTimes(1);
  });
  it("retries only NO_NAVSTART", () => {
    expect([...RETRYABLE_RUNTIME_ERRORS]).toEqual(["NO_NAVSTART"]);
  });
});
