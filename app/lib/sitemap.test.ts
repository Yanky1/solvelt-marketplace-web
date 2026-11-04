import { describe, expect, it } from "vitest";
import { buildSitemap, buildSitemapIndex, childSitemaps, lastmod, pageFromFile, parseSitemapPage, pathFor, SITEMAP_PAGE_SIZE } from "./sitemap";

describe("lastmod", () => {
  it("writes a UTC date-time to the second, whatever offset the API used", () => {
    expect(lastmod("2026-09-04T09:00:00+00:00")).toBe("2026-09-04T09:00:00Z");
    expect(lastmod("2026-09-04T11:30:15.123+02:00")).toBe("2026-09-04T09:30:15Z");
  });
  it("is null for nothing or for text that is not a date", () => {
    for (const v of [null, undefined, "", "yesterday", "2026-13-45"]) expect(lastmod(v)).toBeNull();
  });
});

describe("buildSitemap", () => {
  it("lists absolute, escaped addresses with an optional date", () => {
    const xml = buildSitemap("https://s.example", ["/", { path: "/c/a&b'c", lastmod: "2026-09-04T09:00:00+00:00" }, { path: "/p/x", lastmod: "not a date" }]);
    expect(xml).toContain("<loc>https://s.example/</loc></url>");
    expect(xml).toContain("<loc>https://s.example/c/a&amp;b&apos;c</loc><lastmod>2026-09-04T09:00:00Z</lastmod>");
    expect(xml).toContain("<loc>https://s.example/p/x</loc></url>");                       // a bad date is left out, the entry stays
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });
  it("cannot be broken out of by what is in an address", () => {
    const xml = buildSitemap("https://s.example", ["/</loc><x>"]);
    expect(xml).not.toContain("<x>");
  });
});

describe("sitemap index", () => {
  it("names each child by its absolute address", () => {
    const xml = buildSitemapIndex("https://s.example", ["/sitemaps/static/1.xml", "/sitemaps/listings/1.xml"]);
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<sitemap><loc>https://s.example/sitemaps/listings/1.xml</loc></sitemap>");
  });
  it("has one child sitemap per page of each kind, and always the static one", () => {
    expect(childSitemaps({ listings: 0, categories: 0, brands: 0 })).toEqual(["/sitemaps/static/1.xml"]);
    expect(childSitemaps({ listings: SITEMAP_PAGE_SIZE, categories: 1, brands: 0 })).toEqual(["/sitemaps/static/1.xml", "/sitemaps/listings/1.xml", "/sitemaps/categories/1.xml"]);
    const two = childSitemaps({ listings: SITEMAP_PAGE_SIZE + 1, categories: 0, brands: 0 });
    expect(two).toEqual(["/sitemaps/static/1.xml", "/sitemaps/listings/1.xml", "/sitemaps/listings/2.xml"]);
    expect(childSitemaps({ listings: 10 ** 9, categories: 0, brands: 0 })).toHaveLength(1 + 1000);          // bounded
  });
});

describe("pageFromFile", () => {
  it("reads 1.xml to 9999-bounded pages and nothing else", () => {
    expect(pageFromFile("1.xml")).toBe(1);
    expect(pageFromFile("1000.xml")).toBe(1000);
    for (const bad of ["0.xml", "1001.xml", "01.xml".replace("0", "x"), "1", "1.xml.gz", "-1.xml", "1.XML", "../1.xml", "1e3.xml", ""]) expect(pageFromFile(bad)).toBeNull();
  });
});

describe("parseSitemapPage and pathFor", () => {
  it("reads a page and leaves out entries it cannot address", () => {
    const p = parseSitemapPage({ kind: "listings", page: 1, pageSize: 1000, total: 3, totalPages: 1, items: [{ key: "a", lastModified: "2026-01-01T00:00:00Z" }, { key: "../b" }, { key: "c" }, { nokey: 1 }] }, "listings");
    expect(p?.items).toEqual([{ key: "a", lastModified: "2026-01-01T00:00:00Z" }, { key: "c", lastModified: null }]);
  });
  it("is null when it is not a page", () => {
    for (const bad of [null, "x", {}, { items: [] }, { items: "no", page: 1, pageSize: 1, total: 1, totalPages: 1 }, { items: [], page: -1, pageSize: 1, total: 1, totalPages: 1 }]) expect(parseSitemapPage(bad, "brands")).toBeNull();
  });
  it("gives the page address of each kind", () => {
    expect([pathFor("listings", "a"), pathFor("categories", "b"), pathFor("brands", "c")]).toEqual(["/p/a", "/c/b", "/b/c"]);
  });
});
