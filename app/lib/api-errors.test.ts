import { describe, expect, it } from "vitest";
import { safeFieldErrors } from "./api-errors";

describe("safeFieldErrors", () => {
  it("never shows the API's text for fixed fields (no account enumeration)", () => {
    const e = safeFieldErrors({ email: "This email is already registered", password: "Too short" }, ["email", "password"], ["email"]);
    expect(e.email).toBe("Enter a valid email address.");
    expect(JSON.stringify(e)).not.toMatch(/already registered/i);
    expect(e.password).toBe("Too short");
  });
  it("drops fields that are not allow-listed", () => {
    expect(safeFieldErrors({ isAdmin: "x", password: "p", __proto__: "x" } as Record<string, string>, ["password"])).toEqual({ password: "p" });
  });
  it("caps length, strips control characters and ignores non-strings and empties", () => {
    const e = safeFieldErrors({ displayName: "a\nb".padEnd(500, "x"), city: "" , line1: 5 as unknown as string }, ["displayName", "city", "line1"]);
    expect(e.displayName).toHaveLength(160);
    expect(e.displayName).not.toMatch(/\n/);
    expect(Object.keys(e)).toEqual(["displayName"]);
  });
  it("returns nothing for no errors", () => { expect(safeFieldErrors(undefined, ["email"])).toEqual({}); });
});
