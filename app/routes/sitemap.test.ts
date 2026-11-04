import { describe, expect, it } from "vitest";
import { buildSitemap } from "./sitemap";

describe("buildSitemap", () => {
  it("lists absolute, escaped URLs", () => {
    const xml = buildSitemap("https://s.example", ["/", "/c/a&b"]);
    expect(xml).toContain("<loc>https://s.example/</loc>");
    expect(xml).toContain("<loc>https://s.example/c/a&amp;b</loc>");
  });
});
