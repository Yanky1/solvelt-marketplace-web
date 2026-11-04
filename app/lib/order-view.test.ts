import { describe, expect, it } from "vitest";
import { withoutCoordinates, type OrderDetail } from "./api-client.server";

const order = (over: object = {}) => ({
  number: "MP-1", groups: [{ shipments: [{ position: { lat: 40.693, lng: -73.99, at: "2026-11-04T12:00:00Z" } }, { position: null }],
    returns: [{ label: { url: "https://portal.example/l/1", expiresAt: "x", carrier: null, trackingNumber: null, trackingUrl: null } }, { label: { url: "javascript:alert(1)" } }, { label: null }] }], ...over,
}) as unknown as OrderDetail;

describe("withoutCoordinates", () => {
  it("keeps only the time of a driver position, never the coordinates", () => {
    const out = withoutCoordinates(order());
    expect(out.groups[0]!.shipments[0]!.position).toEqual({ at: "2026-11-04T12:00:00Z" });
    expect(JSON.stringify(out)).not.toMatch(/lat|lng|40\.693/);
    expect(out.groups[0]!.shipments[1]!.position).toBeNull();
  });
  it("drops a return label link that is not https", () => {
    const labels = withoutCoordinates(order()).groups[0]!.returns.map((r) => r.label?.url ?? null);
    expect(labels).toEqual(["https://portal.example/l/1", null, null]);
  });
  it("copes with groups that carry no shipments or returns", () => {
    expect(withoutCoordinates({ number: "x", groups: [{}] } as unknown as OrderDetail).groups[0]!.shipments).toEqual([]);
  });
});
