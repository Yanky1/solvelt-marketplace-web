import http from "node:http";
import { expect, test } from "@playwright/test";

// Found bug (decision M6W-05): an anonymous POST of hundreds of megabytes was read fully into memory (the review photo upload called request.formData() before its size check and its csrf check).
// These run against the real production server (server.js), so they also prove the cap is mounted.
const MB = 1024 * 1024;

test("a body that declares more than the cap is refused with 413 before anything reads it", async ({ request }) => {
  const res = await request.post("/theme", { data: Buffer.alloc(13 * MB, 97), headers: { "content-type": "application/octet-stream" } });
  expect(res.status()).toBe(413);
  expect(res.headers()["cache-control"]).toBe("no-store");
  expect(await res.text()).toContain("too large");
  expect(res.headers()["set-cookie"]).toBeUndefined();                      // the theme action never ran
});

test("the review photo route answers 413 for an oversize upload before it reads the body, signs anyone in, or checks the csrf token", async ({ request }) => {
  const res = await request.post("/account/reviews/0f6c1d3a9b7e4c21", { data: Buffer.alloc(7 * MB, 97), headers: { "content-type": "multipart/form-data; boundary=x" }, maxRedirects: 0 });
  expect(res.status(), `${res.status()} ${(await res.text()).slice(0, 300)}`).toBe(413);   // not 302 to sign-in, not 403 for the missing csrf token: it is refused first
});

test("a chunked body over the cap is cut off while it streams, and the server is fine afterwards", async ({ request, baseURL }) => {
  const url = new URL(baseURL!);
  const outcome = await new Promise<{ status?: number; error?: string; sent: number }>((resolve) => {
    let sent = 0;
    const req = http.request({ host: url.hostname, port: Number(url.port), path: "/theme", method: "POST", headers: { "transfer-encoding": "chunked", "content-type": "application/octet-stream" }, agent: false }, (res) => {
      res.resume(); res.on("end", () => resolve({ status: res.statusCode, sent }));
    });
    req.on("error", (e) => resolve({ error: (e as NodeJS.ErrnoException).code ?? e.message, sent }));
    (async () => {
      for (let i = 0; i < 40 && !req.destroyed; i++) {                      // 40 MB, a megabyte at a time
        const ok = req.write(Buffer.alloc(MB, 97)); sent += MB;
        if (!ok) await new Promise((r) => req.once("drain", r));
      }
      req.end();
    })().catch(() => {});
  });
  expect(outcome.status === 413 || outcome.error !== undefined, JSON.stringify(outcome)).toBe(true);
  expect(outcome.sent).toBeLessThan(40 * MB);                               // the sender was stopped, it did not get to push all of it
  expect((await request.get("/healthz")).status()).toBe(200);
});

test("a normal form post and a normal-sized upload body still go through", async ({ request }) => {
  const small = await request.post("/theme", { form: { theme: "dark", csrf: "wrong" }, maxRedirects: 0 });
  expect(small.status()).not.toBe(413);                                     // refused for its csrf token, not for its size
  const big = await request.post("/account/reviews/0f6c1d3a9b7e4c21", { data: Buffer.alloc(2 * MB, 97), headers: { "content-type": "multipart/form-data; boundary=x" }, maxRedirects: 0 });
  expect(big.status()).not.toBe(413);                                       // 2 MB is within both caps (it is then refused for what it is, not how big)
});
