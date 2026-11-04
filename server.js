// Production Node server: serves the React Router SSR build.
import { randomBytes } from "node:crypto";
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";

// Importing the build runs start-up config validation (fails fast in production).
const build = await import("./build/server/index.js");
const https = (process.env.PUBLIC_ORIGIN ?? "").startsWith("https://");

const app = express();
app.disable("x-powered-by");
// No Express "trust proxy": the client IP is resolved by app/lib/client-ip.server.ts from TRUSTED_PROXIES.

// Security headers, set once for every response (HTML, data, resource routes, static files).
app.use((req, res, next) => {
  const nonce = randomBytes(16).toString("base64");
  res.locals.nonce = nonce;
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'", // React renders style="" attributes (no inline <style> or style tags are allowed)
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  // Pages whose URL carries a one-time token never leak it through Referer.
  const tokenPage = /^\/(verify-email|reset-password|unsubscribe)(\.data)?\/?$/.test(req.path);
  res.setHeader("Referrer-Policy", tokenPage ? "no-referrer" : "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self), publickey-credentials-get=(self), publickey-credentials-create=(self)");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (https) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// Compression is for the built static files only (JavaScript and CSS under /assets): they hold no secret and nothing a visitor typed. HTML and data responses are NOT
// compressed: they can carry a CSRF token next to reflected text (a search box value), which is the shape the BREACH attack needs (decision W2-21).
app.use("/assets", compression(), express.static("build/client/assets", { immutable: true, maxAge: "1y" }));
app.use(express.static("build/client", { maxAge: "1h" }));
app.use(createRequestHandler({
  build,
  getLoadContext: (req, res) => ({ socketAddress: req.socket.remoteAddress ?? "", nonce: String(res.locals.nonce ?? "") }),
}));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`solvelt-web listening on :${port}`));
