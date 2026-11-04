import { describe, expect, it } from "vitest";
import { str, validateDisplayName, validateEmail, validateNewPassword } from "./validation";

describe("validation", () => {
  it.each(["a@b.co", "first.last+tag@example.com"])("accepts email %s", (e) => { expect(validateEmail(e)).toBeNull(); });
  it.each(["", "  ", "nope", "a@b", "a b@c.com", "a@b.c", "x".repeat(250) + "@a.com"])("rejects email %j", (e) => { expect(validateEmail(e)).not.toBeNull(); });
  it("enforces password length bounds", () => {
    expect(validateNewPassword("short")).not.toBeNull();
    expect(validateNewPassword("a".repeat(12))).toBeNull();
    expect(validateNewPassword("a".repeat(129))).not.toBeNull();
  });
  it("validates display name", () => {
    expect(validateDisplayName(" ")).not.toBeNull();
    expect(validateDisplayName("Dana")).toBeNull();
    expect(validateDisplayName("x".repeat(81))).not.toBeNull();
  });
  it("str ignores files and missing keys", () => {
    const f = new FormData(); f.set("a", "1"); f.set("b", new Blob(["x"]), "x.txt");
    expect([str(f, "a"), str(f, "b"), str(f, "c")]).toEqual(["1", "", ""]);
  });
});
