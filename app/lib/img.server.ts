import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * The image pipeline behind `/img/:id`: original bytes in, a resized copy out. Nothing here knows where the bytes came from or what the visitor asked for beyond
 * a width, a height and a format that the route has already checked against fixed sets.
 *
 * Safety limits (an original comes from a seller, so it is untrusted input to a native decoder):
 *  - at most MAX_INPUT_BYTES in (the API already caps it; this is the second wall) and at most MAX_INPUT_PIXELS decoded (a small file can unpack to a huge picture);
 *  - only the formats we expect, detected from the bytes themselves, not from a header or a file name;
 *  - metadata (location, camera, owner) is NOT copied to the output; the stored orientation is applied first so the picture is not turned;
 *  - at most MAX_CONCURRENT resizes at once and MAX_WAITING queued, so a burst of new sizes cannot take the CPU: the rest are refused at once (503) rather than piled up.
 */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 40_000_000;
export const MAX_CONCURRENT = 3;
export const MAX_WAITING = 24;
export const QUALITY = 78;
const INPUT_FORMATS = new Set(["jpeg", "png", "webp", "gif"]);

/**
 * Is this a picture format we resize? libvips reports an AVIF file as `heif` (the container) with `compression: "av1"`, so AVIF is `heif` + AV1. HEIC (the same
 * container with the HEVC codec) is not accepted: the API never passes it on, and its codec is not one we want to link a seller's bytes to.
 */
export function isAllowedInput(meta: { format?: string | undefined; compression?: string | undefined }): boolean {
  if (!meta.format) return false;
  return INPUT_FORMATS.has(meta.format) || (meta.format === "heif" && meta.compression === "av1");
}

export type OutputFormat = "webp" | "jpeg";
export const CONTENT_TYPE: Record<OutputFormat, string> = { webp: "image/webp", jpeg: "image/jpeg" };

/** WebP when the browser says it can read it, JPEG for everything else (every browser reads JPEG; AVIF is slower to make and not worth the CPU here). */
export function negotiateFormat(accept: string | null | undefined): OutputFormat {
  return /(^|[,\s])image\/webp(\s*[;,]|\s*$)/i.test(accept ?? "") ? "webp" : "jpeg";
}

export class ImageError extends Error {
  constructor(readonly reason: "invalid" | "too_large" | "busy") { super(reason); }
}

export interface Resized { body: Buffer; contentType: string; etag: string; width: number; height: number }

/** A resized copy. The box is a maximum: the picture keeps its shape and is never made larger than it is. */
export async function resizeImage(input: Buffer, box: { width: number; height?: number | undefined }, format: OutputFormat): Promise<Resized> {
  if (input.length === 0) throw new ImageError("invalid");
  if (input.length > MAX_INPUT_BYTES) throw new ImageError("too_large");
  try {
    const source = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", sequentialRead: true });
    const meta = await source.metadata();
    if (!isAllowedInput(meta)) throw new ImageError("invalid");        // an SVG, a PDF, a TIFF and anything else is not a picture we serve
    let pipeline = source.rotate().resize({ width: box.width, height: box.height, fit: "inside", withoutEnlargement: true });
    pipeline = format === "webp"
      ? pipeline.webp({ quality: QUALITY, effort: 3 })
      : pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: QUALITY, mozjpeg: false, progressive: true });   // JPEG has no transparency: onto white
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { body: data, contentType: CONTENT_TYPE[format], etag: `"${createHash("sha256").update(data).digest("base64url").slice(0, 22)}"`, width: info.width, height: info.height };
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError("invalid");                                                                // corrupt, truncated, over the pixel limit: all "not a usable picture"
  }
}

/** Runs at most `limit` jobs at once; a job that would have to wait behind `maxWaiting` others is refused. */
export class Limiter {
  private running = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly limit = MAX_CONCURRENT, private readonly maxWaiting = MAX_WAITING) {}
  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      if (this.queue.length >= this.maxWaiting) throw new ImageError("busy");
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else this.running++;
    try { return await job(); }
    finally {
      const next = this.queue.shift();
      if (next) next(); else this.running--;                                                         // hand the slot straight to the next waiter
    }
  }
  get waiting() { return this.queue.length; }
}

/** A cache of resized copies, bounded by bytes (least recently used out first) and by age, that also makes identical requests share one resize. */
export class ResizeCache {
  private readonly entries = new Map<string, { value: Resized; at: number }>();
  private readonly inflight = new Map<string, Promise<Resized>>();
  private bytes = 0;
  constructor(private readonly maxBytes = 64 * 1024 * 1024, private readonly ttlMs = 60 * 60 * 1000, private readonly now: () => number = Date.now) {}

  get size() { return this.entries.size; }
  get totalBytes() { return this.bytes; }

  peek(key: string): Resized | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) { this.drop(key); return undefined; }
    this.entries.delete(key); this.entries.set(key, e);                                              // most recently used goes last
    return e.value;
  }

  async get(key: string, make: () => Promise<Resized>): Promise<Resized> {
    const hit = this.peek(key);
    if (hit) return hit;
    const running = this.inflight.get(key);
    if (running) return running;                                                                     // someone is already making it: wait for theirs
    const p = make().then((v) => { this.set(key, v); return v; }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private set(key: string, value: Resized) {
    if (value.body.length > this.maxBytes) return;                                                   // never cache what alone would not fit
    this.drop(key);
    this.entries.set(key, { value, at: this.now() });
    this.bytes += value.body.length;
    while (this.bytes > this.maxBytes) { const oldest = this.entries.keys().next().value; if (oldest === undefined) break; this.drop(oldest); }
  }
  private drop(key: string) {
    const e = this.entries.get(key);
    if (e) { this.bytes -= e.value.body.length; this.entries.delete(key); }
  }
}

/** The process-wide instances the route uses. */
export const resizeCache = new ResizeCache();
export const resizeLimiter = new Limiter();
sharp.concurrency(2);                                                                                // libvips threads per resize: with the limiter, the CPU stays bounded
