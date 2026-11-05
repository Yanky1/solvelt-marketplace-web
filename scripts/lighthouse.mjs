// Lighthouse on the pages search engines and shoppers meet first: a product page and a category page, as a phone and as a desktop.
// It starts the mock API and the built web server on its own ports, so it does not clash with `npm run e2e`.
//   Fails if SEO, accessibility or best practices score under 95, or if layout shifts by more than 0.1 (deterministic).
//   Performance is printed, not asserted: it depends on the machine, and the CI runner is not a phone.
//   A measurement the browser failed to record (NO_NAVSTART) is repeated once; a score failure never is (scripts/lighthouse-measure.mjs).
// Usage: npm run build && npm run lighthouse     (PW_CHROMIUM_PATH picks another Chromium)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { chromium } from "@playwright/test";
import { measureWithRetry } from "./lighthouse-measure.mjs";

const WEB = 3200, API = 5280;
const FWD_KEY = "Mh3Xt7Bk1Qw5Zn9Vs2Dj6Lc0Rf4Pg8YaE1o";
const PAGES = { "product page": "/p/classic-braided-challah", "category page": "/c/food-drink" };
const MIN = { seo: 0.95, accessibility: 0.95, "best-practices": 0.95 }, MAX_CLS = 0.1;

const children = [];
function start(cmd, args, env) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "inherit"] });
  children.push(child);
  return child;
}
async function waitFor(url, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} did not start`);
}

let failed = false;
try {
  start("node", ["e2e/mock-api.mjs"], { WEB_FORWARDING_KEY: FWD_KEY, PORT: String(API), MOCK_API_PORT: String(API) });
  start("node", ["server.js"], {
    NODE_ENV: "production", PORT: String(WEB), API_BASE_URL: `http://localhost:${API}`, PUBLIC_ORIGIN: `http://localhost:${WEB}`,
    SESSION_COOKIE_SECRET: "Pq8Vn2Ws6Zk0Jd4Lc9Rb3Hm7Ty1Fg5XeA8u", WEB_FORWARDING_KEY: FWD_KEY,
  });
  await waitFor(`http://localhost:${WEB}/healthz`);

  // Warm the server first (the first request renders cold: route modules, the mock API, the image route): the first measurement in a fresh browser should not also be the first request the server ever saw.
  for (const path of Object.values(PAGES)) await fetch(`http://localhost:${WEB}${path}`).then((r) => r.arrayBuffer()).catch(() => undefined);

  const chrome = await chromeLauncher.launch({ chromePath: process.env.PW_CHROMIUM_PATH || chromium.executablePath(), chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  mkdirSync("lighthouse-report", { recursive: true });
  console.log("page".padEnd(16), "device".padEnd(8), "seo", "a11y", "best", "perf", " CLS");
  for (const [name, path] of Object.entries(PAGES)) {
    for (const device of ["mobile", "desktop"]) {
      const flags = { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices", "seo"] };
      // a run the BROWSER failed to record (NO_NAVSTART) is measured once more; nothing else is ever repeated (see lighthouse-measure.mjs)
      const lhr = await measureWithRetry(() => lighthouse(`http://localhost:${WEB}${path}`, flags, device === "desktop" ? desktopConfig : undefined), (m) => console.log(`${name} (${device})${m}`));
      writeFileSync(`lighthouse-report/${name.replace(" ", "-")}-${device}.json`, JSON.stringify(lhr));
      // A run Lighthouse could not complete is a failure that says why, not a crash on a missing number.
      if (lhr.runtimeError) {
        failed = true;
        console.error(`  FAIL ${name} (${device}): Lighthouse could not measure the page: ${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
        for (const w of lhr.runWarnings ?? []) console.error(`    warning: ${w}`);
        continue;
      }
      const score = (id) => Math.round((lhr.categories[id]?.score ?? 0) * 100);
      const cls = lhr.audits["cumulative-layout-shift"]?.numericValue;
      if (typeof cls !== "number") {
        failed = true;
        console.error(`  FAIL ${name} (${device}): no layout-shift measurement (final URL ${lhr.finalDisplayedUrl}; warnings: ${(lhr.runWarnings ?? []).join(" | ") || "none"})`);
        continue;
      }
      console.log(name.padEnd(16), device.padEnd(8), String(score("seo")).padEnd(3), String(score("accessibility")).padEnd(4), String(score("best-practices")).padEnd(4), String(score("performance")).padEnd(4), cls.toFixed(3));
      for (const [id, min] of Object.entries(MIN)) {
        if ((lhr.categories[id]?.score ?? 0) < min) { failed = true; console.error(`  FAIL ${name} (${device}): ${id} ${score(id)} is under ${min * 100}`); }
      }
      if (cls > MAX_CLS) { failed = true; console.error(`  FAIL ${name} (${device}): layout shift ${cls.toFixed(3)} is over ${MAX_CLS}`); }
    }
  }
  await chrome.kill();
} finally {
  for (const c of children) c.kill();
}
process.exit(failed ? 1 : 0);
