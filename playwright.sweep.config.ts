import { defineConfig, devices, type Project } from "@playwright/test";

/**
 * The UI sweep (decision M8W-07): every route, for every role, at every viewport, in light and dark, against the REAL stack (scripts/sweep-setup.mjs builds the world; the API repo's
 * tools/journey/stack.sh runs portal + API + web). It is test tooling only and is kept out of the normal `npm run e2e` (that config matches `*.spec.ts` in e2e/; the sweep files are `*.sweep.ts`).
 *
 *   Chromium: 320, 375, 768, 1280, 1920 px wide, light and dark, plus 1280 at 200% zoom (reflow: 640 CSS px wide at a device scale of 2).
 *   Firefox and WebKit: 375 and 1280, light and dark.
 */
const SWEEP_URL = process.env.SWEEP_WEB_URL ?? "http://localhost:3000";
const HEIGHT = { 320: 640, 375: 812, 768: 1024, 1280: 800, 1920: 1080 } as const;
type Width = keyof typeof HEIGHT;
const SCHEMES = ["light", "dark"] as const;

function project(browser: "chromium" | "firefox" | "webkit", width: Width, scheme: "light" | "dark", zoom = false): Project {
  const base = devices[browser === "chromium" ? "Desktop Chrome" : browser === "firefox" ? "Desktop Firefox" : "Desktop Safari"];
  const viewport = zoom ? { width: width / 2, height: HEIGHT[width] / 2 } : { width, height: HEIGHT[width] };
  return {
    name: `${browser}-${width}${zoom ? "z200" : ""}-${scheme}`,
    metadata: { browser, width, scheme, zoom },
    use: {
      ...base,
      viewport,
      deviceScaleFactor: zoom ? 2 : 1,
      colorScheme: scheme,
      hasTouch: width <= 768,
      // Local sandboxes may ship a different Chromium build; CI installs its own via `playwright install`.
      launchOptions: browser === "chromium" && process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"] } : {},
    },
  };
}

const widths: Width[] = (process.env.SWEEP_WIDTHS ?? "320,375,768,1280,1920").split(",").map((w) => Number(w) as Width);
const browsers = (process.env.SWEEP_BROWSERS ?? "chromium,firefox,webkit").split(",") as Array<"chromium" | "firefox" | "webkit">;
const projects: Project[] = [];
for (const browser of browsers) {
  for (const width of browser === "chromium" ? widths : widths.filter((w) => w === 375 || w === 1280)) {
    for (const scheme of SCHEMES) projects.push(project(browser, width, scheme));
  }
}
if (browsers.includes("chromium") && widths.includes(1280)) for (const scheme of SCHEMES) projects.push(project("chromium", 1280, scheme, true));

export default defineConfig({
  testDir: "e2e/sweep",
  testMatch: /.*\.sweep\.ts/,
  outputDir: "sweep-out/results",
  // the first run writes the baselines (`missing`); a later run compares against them. They are generated on the CI runner (its fonts), not on a laptop: see docs/DESIGN.md M8W-07.
  updateSnapshots: "missing",
  snapshotPathTemplate: "e2e/sweep/baselines/{projectName}/{arg}{ext}",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  retries: 0, // flakiness must show up, like everywhere else
  timeout: 120_000,
  expect: { timeout: 5_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled", caret: "hide" } },
  reporter: [["list"], ["html", { open: "never", outputFolder: "sweep-out/playwright-report" }], ["json", { outputFile: "sweep-out/playwright-results.json" }]],
  use: { baseURL: SWEEP_URL, trace: "off", screenshot: "off" },
  projects,
});
