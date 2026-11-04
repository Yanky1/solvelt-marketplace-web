import { describe, expect, it } from "vitest";
import { formatDate, formatWindow, progressSteps, safeHttps, statusLabel, statusTone, trackingLabel } from "./orders";

describe("order display helpers", () => {
  it("names every status the API can send and falls back for an unknown one", () => {
    for (const s of ["processing", "new", "accepted", "on_hold", "partially_shipped", "shipped", "delivered", "cancelled", "refunded"]) expect(statusLabel(s)).not.toBe("In progress");
    expect(statusLabel("something_new")).toBe("In progress");
    expect(statusTone("delivered")).toBe("ok");
    expect(statusTone("cancelled")).toBe("err");
    expect(statusTone("shipped")).toBe("gold");
    expect(statusTone("new")).toBe("neutral");
  });

  it("only passes plain https links through (never javascript:, data:, http: or garbage)", () => {
    expect(safeHttps("https://tools.usps.com/x?y=1")).toBe("https://tools.usps.com/x?y=1");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://insecure.example/x", "//evil.example", "not a url", "", null, undefined]) expect(safeHttps(bad as string | null | undefined)).toBeNull();
  });

  it("formats dates in UTC with a fixed locale (the server and the browser must print the same text)", () => {
    expect(formatDate("2026-11-04T23:30:00Z")).toBe("Nov 4, 2026");
    expect(formatDate("2026-11-04T23:30:00Z", true)).toBe("Nov 4, 2026, 11:30 PM UTC");
    expect(formatDate(null)).toBe("");
    expect(formatDate("not a date")).toBe("");
    expect(formatWindow("2026-11-04T14:00:00Z", "2026-11-04T16:00:00Z")).toBe("2:00 PM to 4:00 PM UTC");
    expect(formatWindow(null, "2026-11-04T16:00:00Z")).toBe("");
  });

  it("marks progress steps: placed always, then accepted, shipped, delivered; an order on hold has only been accepted", () => {
    const done = (s: string) => progressSteps(s).filter((x) => x.done).map((x) => x.label);
    expect(done("new")).toEqual(["Placed"]);
    expect(done("accepted")).toEqual(["Placed", "Accepted"]);
    expect(done("on_hold")).toEqual(["Placed", "Accepted"]);
    expect(done("partially_shipped")).toEqual(["Placed", "Accepted", "Shipped"]);
    expect(done("shipped")).toEqual(["Placed", "Accepted", "Shipped"]);
    expect(done("delivered")).toEqual(["Placed", "Accepted", "Shipped", "Delivered"]);
  });

  it("words tracking states", () => {
    expect(trackingLabel("out_for_delivery")).toBe("Out for delivery");
    expect(trackingLabel(null)).toBe("");
    expect(trackingLabel("weird")).toBe("In progress");
  });
});
