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

import { COUNTRIES, readAddress, validateAddress, validatePhone } from "./validation";

describe("phone and address validation", () => {
  it.each(["", "+1 (555) 123-4567", "0501234567", "+972-50-123-4567"])("accepts phone %j", (p) => { expect(validatePhone(p)).toBeNull(); });
  it.each(["abc", "12", "+++++++", "<script>", "1".repeat(30)])("rejects phone %j", (p) => { expect(validatePhone(p)).not.toBeNull(); });
  it("can require a phone", () => { expect(validatePhone("", true)).not.toBeNull(); });

  const valid = { fullName: "Dana Levi", line1: "1 Main St", line2: "", city: "Haifa", region: "", postalCode: "3100001", country: "IL", phone: "", isDefault: false };
  it("accepts a complete address", () => { expect(validateAddress(valid)).toEqual({}); });
  it("reports each missing or oversized field", () => {
    const e = validateAddress({ ...valid, fullName: "", line1: "x".repeat(121), city: "", postalCode: "", country: "ZZ", phone: "x" });
    expect(Object.keys(e).sort()).toEqual(["city", "country", "fullName", "line1", "phone", "postalCode"]);
  });
  it("reads a form: trims, upper-cases the country, checkbox on/off", () => {
    const f = new FormData(); f.set("fullName", "  Dana "); f.set("country", "il"); f.set("isDefault", "on");
    const a = readAddress(f);
    expect(a.fullName).toBe("Dana");
    expect(a.country).toBe("IL");
    expect(a.isDefault).toBe(true);
    expect(readAddress(new FormData()).isDefault).toBe(false);
  });
  it("only offers listed countries", () => { expect(Object.keys(COUNTRIES)).toContain("IL"); });
});

import { cleanText } from "./validation";

describe("cleanText", () => {
  it("removes C0/C1 controls and bidi overrides, keeps ordinary and non-Latin text", () => {
    expect(cleanText("a\u0000b\u202eevil\u202c\u2066x\u2069\u200f\u061c\u0085\u009f\u007f\t\n")).toBe("abevilx");
    expect(cleanText("Dana Levi \u05d3\u05e0\u05d4 \u00e9\u00fc")).toBe("Dana Levi \u05d3\u05e0\u05d4 \u00e9\u00fc");
  });
  it("is applied to every address text field when reading a form", () => {
    const f = new FormData();
    for (const k of ["fullName", "line1", "line2", "city", "region", "postalCode", "phone"]) f.set(k, `x\u0000${k}\u202e`);
    f.set("country", "i\u0000l");
    const a = readAddress(f);
    for (const k of ["fullName", "line1", "line2", "city", "region", "postalCode", "phone"] as const) expect(a[k]).toBe(`x${k}`);
    expect(a.country).toBe("IL");
  });
});

describe("cleanText: what is stripped and what must survive", () => {
  const strip = ["\u0000", "\u0007", "\u001f", "\u007f", "\u0085", "\u009f", "\u00ad", "\u061c", "\u200b", "\u200e", "\u200f", "\u2028", "\u2029", "\u202a", "\u202e", "\u2060", "\u2066", "\u2069", "\ufeff", "\ufff9", "\ufffb", "\u{e0000}", "\u{e0041}", "\u{e007f}"];
  it.each(strip)("removes U+%#x", (ch) => { expect(cleanText(`a${ch}b`)).toBe("ab"); });

  it("keeps ZWJ emoji sequences byte-exact", () => {
    const family = "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}"; // man, ZWJ, woman, ZWJ, girl
    expect(cleanText(family)).toBe(family);
    expect(cleanText("\u{1f3f3}\ufe0f\u200d\u{1f308}")).toBe("\u{1f3f3}\ufe0f\u200d\u{1f308}"); // rainbow flag keeps VS16 and ZWJ
  });
  it("keeps ZWNJ (Persian) and Hebrew niqqud and combining marks", () => {
    expect(cleanText("\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645")).toBe("\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645"); // ZWNJ between letters
    expect(cleanText("\u05e9\u05c1\u05b8\u05dc\u05d5\u05b9\u05dd")).toBe("\u05e9\u05c1\u05b8\u05dc\u05d5\u05b9\u05dd"); // shalom with niqqud
    expect(cleanText("e\u0301 n\u0303 a\u030a")).toBe("e\u0301 n\u0303 a\u030a");
    expect(cleanText("\u00c9mile Z\u00f6e \u5c71\u7530")).toBe("\u00c9mile Z\u00f6e \u5c71\u7530");
  });
  it("keeps ordinary punctuation and the plain space", () => { expect(cleanText("O'Brien-Smith, Jr. (Apt 4/B)")).toBe("O'Brien-Smith, Jr. (Apt 4/B)"); });
});
