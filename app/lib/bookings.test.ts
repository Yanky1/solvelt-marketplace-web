import { describe, expect, it } from "vitest";
import { apiLocation, bookingStatus, countdown, groupSlotsByDay, newHoldKey, safeReturnPath, safeZone, secondsLeft } from "./bookings";

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
});
