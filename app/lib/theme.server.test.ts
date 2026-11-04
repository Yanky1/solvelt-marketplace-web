import { describe, expect, it } from "vitest";
import { parseTheme, themeCookie } from "./theme.server";

describe("theme cookie", () => {
  it("defaults to system", () => { expect(parseTheme(null)).toBe("system"); expect(parseTheme("a=b")).toBe("system"); });
  it("reads light and dark among other cookies", () => {
    expect(parseTheme("a=b; solvelt_theme=dark; c=d")).toBe("dark");
    expect(parseTheme("solvelt_theme=light")).toBe("light");
  });
  it("ignores unknown values", () => { expect(parseTheme("solvelt_theme=neon")).toBe("system"); });
  it("sets a long-lived, non-secret cookie", () => {
    const c = themeCookie("dark", true);
    expect(c).toContain("Max-Age=31536000");
    expect(c).toContain("Secure");
    expect(c).not.toContain("HttpOnly");
  });
});
