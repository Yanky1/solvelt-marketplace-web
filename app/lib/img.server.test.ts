import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { ImageError, isAllowedInput, Limiter, MAX_INPUT_BYTES, negotiateFormat, ResizeCache, resizeImage, type Resized } from "./img.server";

const png = (w: number, h: number, opts: { alpha?: boolean; orientation?: number; exif?: boolean } = {}) => {
  let s = sharp({ create: { width: w, height: h, channels: opts.alpha ? 4 : 3, background: opts.alpha ? { r: 255, g: 0, b: 0, alpha: 0 } : { r: 200, g: 120, b: 40 } } });
  if (opts.orientation) s = s.withMetadata({ orientation: opts.orientation });
  if (opts.exif) s = s.withMetadata({ exif: { IFD0: { Copyright: "secret owner", Artist: "A. Photographer" } } });
  return s.png().toBuffer();
};
const meta = (b: Buffer) => sharp(b).metadata();
const fake = (n: number): Resized => ({ body: Buffer.alloc(n), contentType: "image/webp", etag: `"e${n}"`, width: 1, height: 1 });

describe("negotiateFormat", () => {
  it("is WebP only when the browser says it reads WebP, and JPEG otherwise", () => {
    expect(negotiateFormat("image/avif,image/webp,image/apng,image/*,*/*;q=0.8")).toBe("webp");
    expect(negotiateFormat("image/webp")).toBe("webp");
    expect(negotiateFormat("image/webp;q=0.5, */*")).toBe("webp");
    for (const a of [null, undefined, "", "*/*", "image/*", "image/png,image/jpeg", "text/html", "image/webpx"]) expect(negotiateFormat(a)).toBe("jpeg");
  });
});

describe("resizeImage", () => {
  it("keeps the picture's shape inside the box and writes a WebP or a JPEG", async () => {
    const input = await png(1200, 800);
    const w = await resizeImage(input, { width: 480, height: 480 }, "webp");
    expect([w.width, w.height, w.contentType]).toEqual([480, 320, "image/webp"]);              // inside 480 x 480, not squashed into it
    expect((await meta(w.body)).format).toBe("webp");
    const j = await resizeImage(input, { width: 600 }, "jpeg");
    expect([j.width, j.height, j.contentType]).toEqual([600, 400, "image/jpeg"]);
    expect((await meta(j.body)).format).toBe("jpeg");
  });

  it("never makes a picture larger than it is", async () => {
    const r = await resizeImage(await png(100, 50), { width: 1600, height: 1600 }, "webp");
    expect([r.width, r.height]).toEqual([100, 50]);
  });

  it("applies the stored orientation, so a phone photo is not turned", async () => {
    const r = await resizeImage(await png(200, 100, { orientation: 6 }), { width: 1600 }, "webp");     // 6 = turn 90 degrees
    expect([r.width, r.height]).toEqual([100, 200]);
  });

  it("does not copy metadata (owner, camera, place) into the copy", async () => {
    const input = await png(300, 300, { exif: true });
    expect((await meta(input)).exif).toBeTruthy();                                              // the original has it
    for (const format of ["webp", "jpeg"] as const) {
      const out = await resizeImage(input, { width: 160 }, format);
      const m = await meta(out.body);
      expect(m.exif, format).toBeUndefined();
      expect(out.body.includes(Buffer.from("secret owner"))).toBe(false);
    }
  });

  it("puts transparency on white for JPEG and keeps it for WebP", async () => {
    const input = await png(40, 40, { alpha: true });
    const j = await sharp((await resizeImage(input, { width: 40 }, "jpeg")).body).raw().toBuffer();
    expect([j[0], j[1], j[2]].every((v) => v! > 240)).toBe(true);
    const w = await meta((await resizeImage(input, { width: 40 }, "webp")).body);
    expect(w.hasAlpha).toBe(true);
  });

  it("accepts the five formats an original may have", async () => {
    const base = sharp({ create: { width: 64, height: 64, channels: 3, background: "#369" } });
    const inputs = { jpeg: await base.clone().jpeg().toBuffer(), png: await base.clone().png().toBuffer(), webp: await base.clone().webp().toBuffer(), gif: await base.clone().gif().toBuffer(), avif: await base.clone().avif({ effort: 0 }).toBuffer() };
    for (const [name, buf] of Object.entries(inputs)) expect((await resizeImage(buf, { width: 32 }, "webp")).width, name).toBe(32);
  });

  it("refuses what is not a usable picture: nothing, text, an SVG, a document, a cut-off file, other picture formats", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    const tiff = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).tiff().toBuffer();
    const whole = await png(300, 300);
    for (const [name, bad] of Object.entries({ empty: Buffer.alloc(0), text: Buffer.from("hello"), html: Buffer.from("<html></html>"), svg, pdf: Buffer.from("%PDF-1.7 ..."), tiff, truncated: whole.subarray(0, 60) })) {
      await expect(resizeImage(bad, { width: 160 }, "webp"), name).rejects.toMatchObject({ reason: "invalid" });
    }
  });

  it("refuses a small file that would unpack into a huge picture", async () => {
    const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(1_000_000);                                                // small on disk ...
    await expect(resizeImage(bomb, { width: 160 }, "webp")).rejects.toMatchObject({ reason: "invalid" });   // ... 49 million pixels in memory: refused
  });

  it("refuses an original over the byte limit before decoding it", async () => {
    await expect(resizeImage(Buffer.alloc(MAX_INPUT_BYTES + 1), { width: 160 }, "webp")).rejects.toMatchObject({ reason: "too_large" });
  });

  it("gives the same copy the same validator, and a different one for a different size or format", async () => {
    const input = await png(500, 500);
    const a = await resizeImage(input, { width: 320 }, "webp"), b = await resizeImage(input, { width: 320 }, "webp");
    expect(a.etag).toBe(b.etag);
    expect(a.etag).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
    expect((await resizeImage(input, { width: 160 }, "webp")).etag).not.toBe(a.etag);
    expect((await resizeImage(input, { width: 320 }, "jpeg")).etag).not.toBe(a.etag);
  });
});

describe("isAllowedInput", () => {
  it("takes the five picture formats, AVIF being heif with the AV1 codec, and nothing else", () => {
    for (const format of ["jpeg", "png", "webp", "gif"]) expect(isAllowedInput({ format })).toBe(true);
    expect(isAllowedInput({ format: "heif", compression: "av1" })).toBe(true);
    for (const m of [{ format: "heif", compression: "hevc" }, { format: "heif" }, { format: "svg" }, { format: "tiff" }, { format: "pdf" }, { format: "raw" }, { format: undefined }, {}]) expect(isAllowedInput(m), JSON.stringify(m)).toBe(false);
  });
});

describe("Limiter", () => {
  const gate = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };

  it("runs at most `limit` at once and starts the next as soon as one finishes", async () => {
    const lim = new Limiter(2, 10);
    let running = 0, peak = 0;
    const gates = [gate(), gate(), gate(), gate()];
    const jobs = gates.map((g, i) => lim.run(async () => { running++; peak = Math.max(peak, running); await g.p; running--; return i; }));
    await new Promise((r) => setTimeout(r, 10));
    expect([running, lim.waiting]).toEqual([2, 2]);
    gates[0]!.open();
    await new Promise((r) => setTimeout(r, 10));
    expect([running, lim.waiting]).toEqual([2, 1]);                                           // the slot went straight to a waiter
    gates.slice(1).forEach((g) => g.open());
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });

  it("refuses at once, rather than queueing without end, when too many are waiting", async () => {
    const lim = new Limiter(1, 2);
    const g = gate();
    const held = [lim.run(() => g.p), lim.run(() => g.p), lim.run(() => g.p)];              // one running, two waiting
    await expect(lim.run(async () => 1)).rejects.toMatchObject({ reason: "busy" });
    g.open();
    await Promise.all(held);
    expect(await lim.run(async () => "free again")).toBe("free again");
  });

  it("gives its slot back when a job fails", async () => {
    const lim = new Limiter(1, 1);
    await expect(lim.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await lim.run(async () => "ok")).toBe("ok");
  });
});

describe("ResizeCache", () => {
  it("makes a copy once and serves it after", async () => {
    const cache = new ResizeCache(1000);
    const make = vi.fn(async () => fake(100));
    const a = await cache.get("k", make), b = await cache.get("k", make);
    expect(a).toBe(b);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("shares one resize between identical requests that arrive together", async () => {
    const cache = new ResizeCache(1000);
    let n = 0;
    const make = async () => { n++; await new Promise((r) => setTimeout(r, 10)); return fake(100); };
    const [a, b, c] = await Promise.all([cache.get("k", make), cache.get("k", make), cache.get("k", make)]);
    expect(n).toBe(1);
    expect(a === b && b === c).toBe(true);
  });

  it("does not keep a failure, and lets the next request try again", async () => {
    const cache = new ResizeCache(1000);
    await expect(cache.get("k", async () => { throw new ImageError("invalid"); })).rejects.toBeInstanceOf(ImageError);
    expect(cache.size).toBe(0);
    expect((await cache.get("k", async () => fake(10))).body.length).toBe(10);
  });

  it("stays inside its byte budget by dropping the least recently used copies first", async () => {
    const cache = new ResizeCache(250);
    await cache.get("a", async () => fake(100));
    await cache.get("b", async () => fake(100));
    cache.peek("a");                                                                           // a is used again: b is now the oldest
    await cache.get("c", async () => fake(100));
    expect(cache.totalBytes).toBeLessThanOrEqual(250);
    expect([cache.peek("a") !== undefined, cache.peek("b") !== undefined, cache.peek("c") !== undefined]).toEqual([true, false, true]);
  });

  it("does not cache a copy that alone would not fit", async () => {
    const cache = new ResizeCache(50);
    await cache.get("big", async () => fake(100));
    expect([cache.size, cache.totalBytes]).toEqual([0, 0]);
  });

  it("forgets a copy after its time", async () => {
    let t = 0;
    const cache = new ResizeCache(1000, 1000, () => t);
    await cache.get("k", async () => fake(10));
    t = 999; expect(cache.peek("k")).toBeDefined();
    t = 1001; expect(cache.peek("k")).toBeUndefined();
    expect(cache.totalBytes).toBe(0);
  });
});
