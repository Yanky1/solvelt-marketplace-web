import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { gid, IMAGE_BAD, IMAGE_DOWN } from "./mock-catalog.mjs";

const CHALLAH = gid("i:classic-braided-challah:0");          // 1200 x 1200 in the mock catalog
const WIDE = gid("i:classic-braided-challah:1");             // 1600 x 1200
const WEBP = { Accept: "image/avif,image/webp,image/apng,*/*;q=0.8" };
const dims = async (body: Buffer) => { const m = await sharp(body).metadata(); return [m.format, m.width, m.height]; };

test.describe("the image route", () => {
  test("serves WebP to browsers that read it and JPEG to the rest, in the shape asked for", async ({ request }) => {
    const webp = await request.get(`/img/${CHALLAH}?w=480&h=480`, { headers: WEBP });
    expect(webp.status()).toBe(200);
    expect(webp.headers()["content-type"]).toBe("image/webp");
    expect(await dims(await webp.body())).toEqual(["webp", 480, 480]);
    const jpeg = await request.get(`/img/${CHALLAH}?w=480&h=480`, { headers: { Accept: "image/png,image/jpeg" } });
    expect(jpeg.headers()["content-type"]).toBe("image/jpeg");
    expect(await dims(await jpeg.body())).toEqual(["jpeg", 480, 480]);
    // a wide picture keeps its shape inside the box: 1600 x 1200 into 800 x 800 is 800 x 600
    expect(await dims(await (await request.get(`/img/${WIDE}?w=800&h=800`, { headers: WEBP })).body())).toEqual(["webp", 800, 600]);
  });

  test("never enlarges, and the copy carries none of the original's metadata", async ({ request }) => {
    const big = await request.get(`/img/${CHALLAH}?w=1600&h=1600`, { headers: WEBP });
    expect(await dims(await big.body())).toEqual(["webp", 1200, 1200]);                       // the original is 1200 wide: no upscaled file
    for (const accept of [WEBP, {}]) {
      const body = await (await request.get(`/img/${CHALLAH}?w=320`, { headers: accept })).body();
      expect((await sharp(body).metadata()).exif).toBeUndefined();
      expect(body.includes(Buffer.from("mock original"))).toBe(false);                         // the original's copyright text did not travel
    }
  });

  test("has cache headers and a validator, and answers 304 to a matching one", async ({ request }) => {
    const res = await request.get(`/img/${CHALLAH}?w=320&h=320`, { headers: WEBP });
    const h = res.headers();
    expect(h["cache-control"]).toBe("public, max-age=3600");
    expect(h["vary"]).toMatch(/Accept/i);
    expect(h["content-disposition"]).toBe("inline");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toContain("default-src 'self'");                      // the site's policy applies to image responses too
    expect(h["etag"]).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
    expect(h["set-cookie"]).toBeUndefined();
    const again = await request.get(`/img/${CHALLAH}?w=320&h=320`, { headers: { ...WEBP, "If-None-Match": h["etag"]! } });
    expect(again.status()).toBe(304);
    expect((await again.body()).length).toBe(0);
    expect((await request.get(`/img/${CHALLAH}?w=320&h=320`, { headers: { ...WEBP, "If-None-Match": '"other"' } })).status()).toBe(200);
    // JPEG and WebP copies are different bodies with different validators: a cache keyed on Accept cannot mix them up
    expect((await request.get(`/img/${CHALLAH}?w=320&h=320`)).headers()["etag"]).not.toBe(h["etag"]);
  });

  test("an image the catalog does not show is 404, and the API's refusals are mapped honestly and never cached", async ({ request }) => {
    const missing = await request.get(`/img/${gid("i:not-in-any-listing")}?w=320`);
    expect(missing.status()).toBe(404);
    expect(missing.headers()["cache-control"]).toBe("no-store");
    const bad = await request.get(`/img/${IMAGE_BAD}?w=320`);
    expect(bad.status()).toBe(502);
    expect(bad.headers()["cache-control"]).toBe("no-store");
    const down = await request.get(`/img/${IMAGE_DOWN}?w=320`);
    expect(down.status()).toBe(503);
    expect(down.headers()["retry-after"]).toBe("30");
    expect(down.headers()["cache-control"]).toBe("no-store");
  });

  test("refuses every address that is not a known id with a served width and a sane height, before asking anyone", async ({ request }) => {
    const get = async (path: string) => (await request.get(path)).status();
    expect(await get(`/img/${CHALLAH}?w=641`)).toBe(400);                                       // only the served widths
    expect(await get(`/img/${CHALLAH}`)).toBe(400);
    for (const w of ["abc", "3.2e2", "0320", "-320", "%20320", "", "320.0"]) expect(await get(`/img/${CHALLAH}?w=${w}`), `w=${w}`).toBe(400);
    for (const h of ["0", "-5", "4001", "99999", "1.5", "abc", "1e3", "0100", "%20100", ""]) expect(await get(`/img/${CHALLAH}?w=320&h=${h}`), `h=${h}`).toBe(400);
    for (const id of ["not-a-guid", "..%2F..%2Fetc%2Fpasswd", "%00", "a".repeat(300), "http%3A%2F%2Fevil.example%2Fx.png"]) expect(await get(`/img/${id}?w=320`), id).toBe(404);
    // anything else in the address is ignored: it cannot name another source
    const extra = await request.get(`/img/${CHALLAH}?w=320&url=http://evil.example/x.png&src=/etc/passwd&format=svg`, { headers: WEBP });
    expect(extra.status()).toBe(200);
    expect(await dims(await extra.body())).toEqual(["webp", 320, 320]);
  });

  test("an upper-case id is the same image as a lower-case one", async ({ request }) => {
    const a = await request.get(`/img/${CHALLAH}?w=160`, { headers: WEBP });
    const b = await request.get(`/img/${CHALLAH.toUpperCase()}?w=160`, { headers: WEBP });
    expect(b.status()).toBe(200);
    expect(b.headers()["etag"]).toBe(a.headers()["etag"]);
  });

  test("identical requests that arrive together all succeed with the same copy", async ({ request }) => {
    const all = await Promise.all(Array.from({ length: 12 }, () => request.get(`/img/${WIDE}?w=640&h=480`, { headers: WEBP })));
    expect(all.map((r) => r.status())).toEqual(Array(12).fill(200));
    expect(new Set(all.map((r) => r.headers()["etag"])).size).toBe(1);
  });

  test("a burst of different sizes is served or refused politely, never an error", async ({ request }) => {
    const widths = [160, 320, 480, 640, 800, 1200];
    const burst = await Promise.all(Array.from({ length: 30 }, (_, i) => request.get(`/img/${i % 2 ? CHALLAH : WIDE}?w=${widths[i % widths.length]}&h=${100 + i * 3}`, { headers: WEBP })));
    for (const r of burst) expect([200, 503]).toContain(r.status());
    expect(burst.filter((r) => r.status() === 200).length).toBeGreaterThan(0);
  });
});

test.describe("pictures on the pages", () => {
  test("the product page's pictures really load, from our own address, in a browser", async ({ page }) => {
    await page.goto("/p/classic-braided-challah");
    const main = page.locator(".gallery-main img");
    await expect(main).toBeVisible();
    await expect.poll(() => main.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    expect(await main.evaluate((el: HTMLImageElement) => new URL(el.currentSrc).origin === location.origin)).toBe(true);
    expect(await main.evaluate((el: HTMLImageElement) => el.currentSrc)).toMatch(/\/img\/[0-9a-f-]{36}\?w=\d+&h=\d+/);
  });

  test("a results page's pictures load too, and none is broken", async ({ page }) => {
    await page.goto("/c/gifts");
    await page.locator(".listing-card-media img").last().scrollIntoViewIfNeeded();
    await expect.poll(() => page.locator(".listing-card-media img").evaluateAll((els) => (els as HTMLImageElement[]).filter((e) => e.complete && e.naturalWidth === 0).length)).toBe(0);
    await expect.poll(() => page.locator(".listing-card-media img").evaluateAll((els) => (els as HTMLImageElement[]).filter((e) => e.naturalWidth > 0).length)).toBeGreaterThan(5);
  });
});
