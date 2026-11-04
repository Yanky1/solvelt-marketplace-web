import { describe, expect, it } from "vitest";
import { buildSitemap, xmlResponse } from "./sitemap";

describe("buildSitemap", () => {
  it("lists absolute, escaped URLs", () => {
    const xml = buildSitemap("https://s.example", ["/", "/c/a&b"]);
    expect(xml).toContain("<loc>https://s.example/</loc>");
    expect(xml).toContain("<loc>https://s.example/c/a&amp;b</loc>");
  });
});

describe("xmlResponse", () => {
  const get = (headers: Record<string, string> = {}, method = "GET") => new Request("https://s.example/sitemap.xml", { method, headers });
  it("answers XML with a validator, a cache rule and no cookie", async () => {
    const res = xmlResponse(get(), "<a/>", "2026-09-04T09:00:00Z");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
    expect(res.headers.get("last-modified")).toBe("Fri, 04 Sep 2026 09:00:00 GMT");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toBe("<a/>");
  });
  it("has the same validator for the same body and another for a changed one", () => {
    expect(xmlResponse(get(), "<a/>").headers.get("etag")).toBe(xmlResponse(get(), "<a/>").headers.get("etag"));
    expect(xmlResponse(get(), "<a/>").headers.get("etag")).not.toBe(xmlResponse(get(), "<b/>").headers.get("etag"));
  });
  it("answers 304 with no body when the validator matches (also weak, or among several), and 200 when it does not", async () => {
    const etag = xmlResponse(get(), "<a/>").headers.get("etag")!;
    for (const header of [etag, `W/${etag}`, `"zzz", ${etag}`]) {
      const res = xmlResponse(get({ "If-None-Match": header }), "<a/>");
      expect(res.status, header).toBe(304);
      expect(await res.text()).toBe("");
      expect(res.headers.get("etag")).toBe(etag);
    }
    expect(xmlResponse(get({ "If-None-Match": '"other"' }), "<a/>").status).toBe(200);
  });
  it("sends no body for HEAD", async () => {
    expect(await xmlResponse(get({}, "HEAD"), "<a/>").text()).toBe("");
  });
});
