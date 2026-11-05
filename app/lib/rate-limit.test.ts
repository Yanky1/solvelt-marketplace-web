import { describe, expect, it } from "vitest";
import { retryAfterHeader, tooManyMessage } from "./rate-limit";

describe("tooManyMessage", () => {
  it("says a moment when no wait is known or the wait is not a sensible number", () => {
    for (const v of [undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) expect(tooManyMessage(v), String(v)).toBe("Too many attempts. Please wait a moment and try again.");
  });
  it("rounds up to seconds, minutes or hours", () => {
    expect(tooManyMessage(1)).toContain("about 1 second and");
    expect(tooManyMessage(1.2)).toContain("about 2 seconds");
    expect(tooManyMessage(45)).toContain("about 45 seconds");
    expect(tooManyMessage(120)).toContain("about 2 minutes");
    expect(tooManyMessage(3600)).toContain("about 60 minutes");
    expect(tooManyMessage(7200)).toContain("about 2 hours");
    expect(tooManyMessage(10 ** 9)).toContain("about 24 hours");              // capped at a day
  });
});

describe("retryAfterHeader", () => {
  it("is a whole number of seconds, only when sensible", () => {
    expect(retryAfterHeader(2.1)).toEqual({ "Retry-After": "3" });
    expect(retryAfterHeader(10 ** 9)).toEqual({ "Retry-After": "86400" });
    for (const v of [undefined, 0, -1, Number.NaN]) expect(retryAfterHeader(v)).toEqual({});
  });
});
