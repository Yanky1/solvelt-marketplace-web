import { describe, expect, it } from "vitest";
import { apiLocation, bookingStatus, countdown, EXTRA_CHARGE_TEXT, isQuoteOnly, quoteStatus, groupSlotsByDay, newHoldKey, pickAddOns, policyLines, servicePath, safeReturnPath, safeZone, secondsLeft } from "./bookings";

const slot = (startAt: string) => ({ startAt, endAt: Number.isNaN(Date.parse(startAt)) ? startAt : new Date(Date.parse(startAt) + 3600_000).toISOString(), providerIds: ["p1"] });

describe("booking helpers", () => {
  it("names places the way the API does", () => {
    expect([apiLocation("online"), apiLocation("at-home"), apiLocation("at-seller")]).toEqual(["online", "customer", "seller"]);
  });

  it("groups slots by the provider's calendar day, in time order", () => {
    // 03:30 UTC on Nov 5 is still the evening of Nov 4 in Los Angeles
    const days = groupSlotsByDay([slot("2026-11-05T17:00:00Z"), slot("2026-11-05T03:30:00Z"), slot("2026-11-05T16:00:00Z")], "America/Los_Angeles");
    expect(days.map((d) => d.key)).toEqual(["2026-11-04", "2026-11-05"]);
    expect(days[0]!.label).toBe("Wed, Nov 4");
    expect(days[0]!.slots.map((s) => s.label)).toEqual(["7:30 PM"]);
    expect(days[1]!.slots.map((s) => s.label)).toEqual(["8:00 AM", "9:00 AM"]);
  });

  it("falls back to UTC for a zone it does not know and skips unusable times", () => {
    expect(safeZone("Mars/Olympus")).toBe("UTC");
    expect(safeZone(undefined)).toBe("UTC");
    expect(groupSlotsByDay([slot("not a date"), slot("2026-11-05T10:00:00Z")], "Mars/Olympus")).toHaveLength(1);
  });

  it("counts a hold down and never below zero", () => {
    const now = Date.parse("2026-11-05T10:00:00Z");
    expect(secondsLeft("2026-11-05T10:04:05Z", now)).toBe(245);
    expect(secondsLeft("2026-11-05T09:00:00Z", now)).toBe(0);
    expect(secondsLeft(null, now)).toBe(0);
    expect(countdown(245)).toBe("4:05");
    expect(countdown(-3)).toBe("0:00");
  });

  it("describes every status the API can send, and an unknown one plainly", () => {
    for (const s of ["Hold", "Requested", "Confirmed", "Rescheduled", "InProgress", "Completed", "Declined", "Expired", "CancelledByBuyer", "CancelledBySeller", "NoShow"]) {
      expect(bookingStatus(s).label.length).toBeGreaterThan(2);
      expect(bookingStatus(s).text.length).toBeGreaterThan(10);
    }
    expect(bookingStatus("Confirmed").tone).toBe("good");
    expect(bookingStatus("Weird").text).toMatch(/updating/);
  });

  it("only returns paths of our own site", () => {
    expect(safeReturnPath("/p/deep-house-cleaning?x=1")).toBe("/p/deep-house-cleaning?x=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "javascript:alert(1)", "", null, undefined, "/a\nb"]) expect(safeReturnPath(bad as string | null)).toBe("/");
  });

  it("makes hold keys the API accepts", () => {
    const k = newHoldKey();
    expect(k).toMatch(/^[A-Za-z0-9\-_.:]{8,100}$/);
    expect(newHoldKey()).not.toBe(k);
  });

  it("says the policy in plain words, a sentence per known fact and nothing for an unknown one", () => {
    expect(policyLines({ cancelFreeHours: 24, cancelFeePercent: 50, noShowFeePercent: 100, maxReschedules: 2, approvalHours: null })).toEqual([
      "Free cancellation until 24 hours before the start; after that, 50% of the price is kept.", "If you do not show up, 100% of the price is kept.", "You can change the time up to 2 times.",
    ]);
    expect(policyLines({ cancelFreeHours: 72, cancelFeePercent: 0, maxReschedules: 0 })).toEqual(["Free cancellation at any time up to 3 days before the start.", "This booking cannot be moved to another time."]);
    expect(policyLines({ cancelFreeHours: 1, cancelFeePercent: 100, maxReschedules: 1 })[0]).toContain("1 hour before");
    expect(policyLines({ cancelFreeHours: null, cancelFeePercent: null, noShowFeePercent: null, maxReschedules: null, approvalHours: 12 })).toEqual([]);
    expect(policyLines(null)).toEqual([]);
  });

  it("keeps only the add-ons the service offers, once each, in a stable order", () => {
    const offered = [{ id: "b", name: "B", priceCents: 1, extraMinutes: 0 }, { id: "a", name: "A", priceCents: 1, extraMinutes: 0 }];
    expect(pickAddOns(["b", "zzz", "a", "b"], offered)).toEqual(["a", "b"]);
    expect(pickAddOns([], offered)).toEqual([]);
  });

  it("knows a service the provider prices per job, whatever the case the portal uses", () => {
    expect([isQuoteOnly("quote"), isQuoteOnly("Quote"), isQuoteOnly(" QUOTE ")]).toEqual([true, true, true]);
    expect([isQuoteOnly("fixed"), isQuoteOnly("hourly"), isQuoteOnly(undefined), isQuoteOnly("")]).toEqual([false, false, false, false]);
  });

  it("has words for every quote status and every extra-charge state, and a plain fallback", () => {
    for (const s of ["Requested", "Quoted", "Accepted", "Declined", "Withdrawn", "Expired"]) expect(quoteStatus(s).text.length).toBeGreaterThan(10);
    expect(quoteStatus("Quoted").tone).toBe("good");
    expect(quoteStatus("Mystery").text).toMatch(/updating/);
    expect(Object.keys(EXTRA_CHARGE_TEXT).sort()).toEqual(["consented", "declined", "paid", "requested"]);
  });

  it("links to a service page only for a plain slug", () => {
    expect(servicePath("deep-house-cleaning")).toBe("/p/deep-house-cleaning");
    for (const bad of [null, undefined, "", "../admin", "a/b", "a b", "x?y=1", "//evil.example", "-lead"]) expect(servicePath(bad as string | null)).toBeNull();
  });
});
