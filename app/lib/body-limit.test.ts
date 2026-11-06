// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module at the repository root (server.js imports it)
import { MAX_BODY_BYTES, bodyLimitMiddleware } from "../../body-limit.js";

/**
 * Found bug (decision M6W-05): a huge anonymous POST was read fully into memory by whatever called request.formData(). These run a real HTTP server with the middleware in front of a handler that reads the
 * body the way an action does, and a small cap so they stay fast.
 */
const CAP = 64 * 1024;
const servers: http.Server[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

type Seen = { calls: number; bytes: number; ended: boolean; aborted: boolean };
async function start(cap = CAP) {
  const seen: Seen = { calls: 0, bytes: 0, ended: false, aborted: false };
  const app = express();
  app.use(bodyLimitMiddleware(cap));
  app.all("/echo", (req, res) => {
    seen.calls++;
    let mine = 0;                                                                       // this request's bytes (seen.bytes adds up over all of them)
    req.on("data", (c: Buffer) => { mine += c.length; seen.bytes += c.length; });
    req.on("end", () => { seen.ended = true; res.json({ bytes: mine }); });
    req.on("error", () => { seen.aborted = true; });
    req.on("aborted", () => { seen.aborted = true; });
  });
  app.get("/ok", (_req, res) => { res.send("ok"); });
  const server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  servers.push(server);
  return { port: (server.address() as AddressInfo).port, seen };
}

type Outcome = { status?: number; body?: string; error?: string; connection?: string | string[] | undefined };
/** Sends `chunks`; chunked (no Content-Length) or with the true Content-Length, or with a declared length that is not the real one. */
function send(port: number, chunks: Buffer[], opts: { method?: string; chunked?: boolean; declared?: number } = {}): Promise<Outcome> {
  return new Promise((resolve) => {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const headers: Record<string, string | number> = opts.chunked ? { "transfer-encoding": "chunked" } : { "content-length": opts.declared ?? total };
    const req = http.request({ host: "127.0.0.1", port, path: "/echo", method: opts.method ?? "POST", headers, agent: false }, (res) => {
      let body = ""; res.on("data", (d) => { body += d; }); res.on("end", () => resolve({ status: res.statusCode, body, connection: res.headers.connection }));
    });
    req.on("error", (e) => resolve({ error: (e as NodeJS.ErrnoException).code ?? e.message }));
    (async () => {
      for (const c of chunks) { if (req.destroyed) return; if (!req.write(c)) await new Promise((r) => req.once("drain", r)); }
      req.end();
    })().catch(() => {});
  });
}
const chunk = (n: number) => Buffer.alloc(n, 97);

describe("body limit middleware", () => {
  it("lets a normal body through intact, declared or chunked (the counting must not take bytes from the real reader)", async () => {
    const { port, seen } = await start();
    const a = await send(port, [chunk(10_000), chunk(20_000)]);
    expect(a.status).toBe(200); expect(JSON.parse(a.body!).bytes).toBe(30_000);
    const b = await send(port, [chunk(10_000), chunk(10_000), chunk(10_000)], { chunked: true });
    expect(b.status).toBe(200); expect(JSON.parse(b.body!).bytes).toBe(30_000);
    expect(seen.calls).toBe(2);
    const exact = await send(port, [chunk(CAP)]);                                       // exactly the cap is allowed
    expect(exact.status).toBe(200);
    const edgeChunked = await send(port, [chunk(CAP / 2), chunk(CAP / 2)], { chunked: true });
    expect(edgeChunked.status).toBe(200);
  });

  it("refuses a declared size over the cap with 413 BEFORE the handler runs, for every method that has a body", async () => {
    const { port, seen } = await start();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await send(port, [chunk(CAP + 1)], { method });
      expect(r.status, method).toBe(413);
      expect(r.body).toContain("too large");
    }
    expect(seen.calls).toBe(0);                                                         // no action, no parse
    expect((await send(port, [chunk(1000)])).status).toBe(200);                         // and the server carries on
  });

  it("refuses an oversize declared size without waiting for the body: a huge Content-Length with a tiny body is 413 at once", async () => {
    const { port, seen } = await start();
    const r = await send(port, [chunk(10)], { declared: 500 * 1024 * 1024 });
    expect(r.status).toBe(413);
    expect(seen.calls).toBe(0);
  });

  it("cuts off a chunked body the moment it goes over the cap: the reader stops with an error and never gets the whole thing", async () => {
    const { port, seen } = await start();
    const chunks = Array.from({ length: 40 }, () => chunk(16 * 1024));                  // 640 KB against a 64 KB cap
    const r = await send(port, chunks, { chunked: true });
    expect(r.status === 413 || r.error !== undefined).toBe(true);                       // the 413 when it gets through, else the connection is cut
    await new Promise((res) => setTimeout(res, 100));
    expect(seen.ended).toBe(false);                                                     // the handler never saw a complete body
    expect(seen.aborted).toBe(true);
    expect(seen.bytes).toBeLessThan(40 * 16 * 1024);
    const health = await new Promise<number | undefined>((resolve) => http.get({ host: "127.0.0.1", port, path: "/ok", agent: false }, (res) => { res.resume(); resolve(res.statusCode); }));
    expect(health).toBe(200);                                                           // the server is fine afterwards
  });

  it("does not touch requests without a body method, and ships a generous default for the site's one 5 MB upload", async () => {
    const { port } = await start();
    const ok = await new Promise<number | undefined>((resolve) => http.get({ host: "127.0.0.1", port, path: "/ok", agent: false }, (res) => { res.resume(); resolve(res.statusCode); }));
    expect(ok).toBe(200);
    expect(MAX_BODY_BYTES).toBeGreaterThan(6 * 1024 * 1024);                            // more than the upload route's own cap (+ framing)
    expect(MAX_BODY_BYTES).toBeLessThanOrEqual(32 * 1024 * 1024);                       // and far from unbounded
  });
});
