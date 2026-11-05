import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module at the repository root (server.js imports it)
import { publicOriginMiddleware } from "../../proxy-origin.js";

/**
 * Decision M8W-04. Behind Azure's TLS termination the server sees http; React Router builds request.url from req.protocol and the Host header and its single-fetch CSRF guard compares that with
 * the browser's Origin. These tests run a real HTTP server and build the URL exactly the way @react-router/express does (`${req.protocol}://${req.hostname}${req.originalUrl}`).
 */
const servers: http.Server[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

async function start(publicOrigin: string | undefined) {
  const app = express();   // no "trust proxy", like server.js
  app.use(publicOriginMiddleware(publicOrigin));
  // the same steps as createRemixRequest in @react-router/express (it adds the port from the Host header to Express's port-less hostname)
  app.all("/{*path}", (req, res) => {
    const port = Number.parseInt((req.get("host") ?? "").split(":")[1] ?? "", 10);
    const host = `${req.hostname.split(/[\\/?#@]/)[0] || "localhost"}${Number.isSafeInteger(port) ? `:${port}` : ""}`;
    res.json({ url: new URL(`${req.protocol}://${host}${req.originalUrl}`).href, host: req.get("host") });
  });
  const server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return async (path: string, headers: Record<string, string> = {}) => {
    const res = await new Promise<{ body: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, headers }, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => resolve({ body: b })); });
      req.on("error", reject); req.end();
    });
    return JSON.parse(res.body) as { url: string; host: string };
  };
}

describe("the request URL behind a TLS-terminating proxy", () => {
  it("is the site's own https origin, although the server itself speaks http", async () => {
    const get = await start("https://shop.example.test");
    const seen = await get("/checkout.data?x=1", { Host: "10.0.0.7:8080" });                // what Azure's front end sends to the container
    expect(seen.url).toBe("https://shop.example.test/checkout.data?x=1");
  });

  it("overwrites a Host that is not the site's own", async () => {
    const get = await start("https://shop.example.test");
    expect((await get("/", { Host: "evil.example" })).url).toBe("https://shop.example.test/");
  });

  it("never reads X-Forwarded-Proto or X-Forwarded-Host from the peer", async () => {
    const get = await start("https://shop.example.test");
    const seen = await get("/", { "X-Forwarded-Proto": "http", "X-Forwarded-Host": "evil.example", Forwarded: "host=evil.example;proto=http" });
    expect(seen.url).toBe("https://shop.example.test/");
    const plain = await start("http://localhost:3100");
    expect((await plain("/", { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "evil.example" })).url).toBe("http://localhost:3100/");
  });

  it("keeps the port of the configured origin", async () => {
    const get = await start("https://shop.example.test:8443");
    expect((await get("/")).url).toBe("https://shop.example.test:8443/");
  });

  it("changes nothing when there is no usable PUBLIC_ORIGIN (development)", async () => {
    for (const none of [undefined, "", "not a url", "ftp://x.example"]) {
      const get = await start(none);
      const seen = await get("/", { Host: "localhost:3000" });
      expect(seen.url).toBe("http://localhost:3000/");   // untouched: Express's own reading of the Host header, scheme from the socket
    }
  });

  it("matches what the CSRF guard compares: an Origin of the site is equal to the request URL's origin, a foreign one is not", async () => {
    const get = await start("https://shop.example.test");
    const { url } = await get("/sign-in.data", { Host: "10.0.0.7:8080" });
    expect(new URL(url).origin).toBe(new URL("https://shop.example.test").origin);
    expect(new URL(url).origin).not.toBe(new URL("https://evil.example").origin);
  });
});
