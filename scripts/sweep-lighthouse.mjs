// Lighthouse layout shift (CLS) and Largest Contentful Paint (LCP) on the five pages that matter most: home, search, a product page, the cart and the checkout, as a phone and as a desktop,
// against the REAL stack the sweep runs on (decision M8W-07). It writes sweep-out/lighthouse.json (one record per page and device, the same shape as the sweep's findings) and a table.
//   CLS over 0.1 is a finding. LCP over 4000 ms ("poor" in Lighthouse's own scale) is a finding; a CI runner is not a phone, so the stricter 2500 ms "good" line is printed, not asserted.
// Usage: node scripts/sweep-lighthouse.mjs     (reads sweep-out/world.json from `npm run sweep:setup`; SWEEP_WEB_URL picks the site, PW_CHROMIUM_PATH another Chromium)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { chromium } from "@playwright/test";
import { measureWithRetry } from "./lighthouse-measure.mjs";

const world = JSON.parse(readFileSync("sweep-out/world.json", "utf8"));
const WEB = (process.env.SWEEP_WEB_URL ?? world.web).replace(/\/+$/, "");
const PAGES = { home: "/", search: `/search?q=${encodeURIComponent(world.searchTerm)}`, "product page": `/p/${world.slug}`, cart: "/cart", checkout: "/checkout" };
const MAX_CLS = 0.1, MAX_LCP_MS = 4000, GOOD_LCP_MS = 2500;

const chrome = await chromeLauncher.launch({ chromePath: process.env.PW_CHROMIUM_PATH || chromium.executablePath(), chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const records = [];
try {
  for (const path of Object.values(PAGES)) await fetch(`${WEB}${path}`).then((r) => r.arrayBuffer()).catch(() => undefined);   // warm the server: the first render is cold
  console.log("page".padEnd(14), "device".padEnd(8), "CLS".padEnd(7), "LCP ms");
  for (const [name, path] of Object.entries(PAGES)) {
    for (const device of ["mobile", "desktop"]) {
      const flags = { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance"] };
      const lhr = await measureWithRetry(() => lighthouse(`${WEB}${path}`, flags, device === "desktop" ? desktopConfig : undefined), (m) => console.log(`${name} (${device})${m}`));
      const found = [];
      if (lhr.runtimeError) found.push(`Lighthouse could not measure the page: ${lhr.runtimeError.code}`);
      const cls = lhr.audits?.["cumulative-layout-shift"]?.numericValue, lcp = lhr.audits?.["largest-contentful-paint"]?.numericValue;
      if (typeof cls === "number" && cls > MAX_CLS) found.push(`layout shift ${cls.toFixed(3)} is over ${MAX_CLS}`);
      if (typeof lcp === "number" && lcp > MAX_LCP_MS) found.push(`LCP ${Math.round(lcp)} ms is over ${MAX_LCP_MS} ms`);
      records.push({ page: name, path, device, cls: cls ?? null, lcpMs: lcp ?? null, lcpGood: typeof lcp === "number" ? lcp <= GOOD_LCP_MS : null, found });
      console.log(name.padEnd(14), device.padEnd(8), String(cls?.toFixed(3) ?? "n/a").padEnd(7), String(Math.round(lcp ?? 0)), found.length ? `FINDING: ${found.join("; ")}` : "");
    }
  }
} finally { await chrome.kill(); }
mkdirSync("sweep-out", { recursive: true });
writeFileSync("sweep-out/lighthouse.json", JSON.stringify(records, null, 2));
process.exit(records.some((r) => r.found.length) ? 1 : 0);
