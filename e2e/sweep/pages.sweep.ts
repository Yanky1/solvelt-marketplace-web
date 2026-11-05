import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type TestInfo } from "@playwright/test";
import { axeFindings, clickEverything, keyboardFindings, layoutFindings, settle, SHELL_SCOPE, watchPage, type Findings } from "./checks";
import { plan, type Role, type World } from "./routes";

/**
 * The sweep (decision M8W-07): for every route and role in the plan, in the current project's browser, viewport and theme: load it; click what can be clicked (not the denylist); check the
 * layout, the tap targets, accessibility (axe WCAG 2.2 AA) and keyboard reach with a visible focus indicator; take a full-page screenshot (published) and compare it with the baseline.
 * Findings are collected per category with soft assertions, so one page can report several, and every page also writes one record (sweep-out/records) for the report.
 */
const OUT = join(process.cwd(), "sweep-out");
const worldFile = join(OUT, "world.json");
const world: World | null = existsSync(worldFile) ? (JSON.parse(readFileSync(worldFile, "utf8")) as World) : null;
const { visits, skipped, unclassified } = plan();
const slug = (s: string) => (s === "*" ? "not-found" : s.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home");

// (Playwright wants the first argument destructured, and the linter wants no empty pattern: so a fixture that is also worth a check is taken)
test("the sweep has its world, and every route in the router is classified", async ({ baseURL }, info) => {
  expect(baseURL, "no baseURL: SWEEP_WEB_URL is not set").toBeTruthy();
  expect(world, "scripts/sweep-setup.mjs has not run (no sweep-out/world.json)").not.toBeNull();
  expect(unclassified, "routes in the router that e2e/sweep/routes.ts does not classify").toEqual([]);
  info.annotations.push({ type: "skipped-routes", description: String(skipped.length) });
});

function record(info: TestInfo, data: Record<string, unknown>) {
  mkdirSync(join(OUT, "records"), { recursive: true });
  appendFileSync(join(OUT, "records", `w${process.pid}.jsonl`), JSON.stringify({ project: info.project.name, ...info.project.metadata, ...data }) + "\n");
}

const roles = [...new Set(visits.map((v) => v.role))] as Role[];
for (const role of roles) {
  test.describe(`as ${role}`, () => {
    const state = world?.states[role];
    if (state) test.use({ storageState: state });
    for (const { page: spec } of visits.filter((v) => v.role === role)) {
      test(spec.pattern, async ({ page, context, baseURL }, info) => {
        test.skip(!world, "no world: scripts/sweep-setup.mjs has not run");
        test.skip(role !== "guest" && !state, `no signed-in session for ${role} (setup could not create one)`);
        const url = spec.path(world!);
        test.skip(url === null, "no fixture for this route in the world");
        const scheme = String(info.project.metadata.scheme);
        const isChromium = info.project.metadata.browser === "chromium";
        await context.addCookies([{ name: "solvelt_theme", value: scheme, url: baseURL! }]);

        const expected = spec.status ?? [200];
        const watcher = watchPage(page, expected);
        const found: Record<string, Findings> = {};
        const t0 = Date.now();
        const res = await page.goto(url!, { waitUntil: "domcontentloaded" });
        await settle(page);
        const status = res?.status() ?? 0;
        found.status = expected.includes(status) || (status >= 300 && status < 400) ? [] : [`the page answered ${status} (expected ${expected.join(" or ")})`];

        // layout, tap targets
        const lay = await layoutFindings(page);
        found.layout = lay.layout;
        found.tap = lay.tap;
        // accessibility and keyboard
        found.axe = await axeFindings(page).catch((e) => [`axe failed to run: ${String(e).slice(0, 120)}`]);
        found.keyboard = await keyboardFindings(page);

        // screenshots: published (full page), and compared with the baseline (dynamic content masked)
        const shot = `shots/${role}/${slug(spec.pattern)}/${info.project.name}.png`;
        mkdirSync(join(OUT, "shots", role, slug(spec.pattern)), { recursive: true });
        await page.screenshot({ path: join(OUT, shot), fullPage: true, animations: "disabled" });
        // dynamic content: dates and times (the data is made fresh on every run), ids and the buyer's address of the world
        const masks = [page.locator("time"), page.locator("[data-sweep-mask]"), page.locator("img[src*='/img/']"), page.locator(":text-matches('\\\\b20\\\\d\\\\d\\\\b|\\\\b\\\\d{1,2}:\\\\d{2}\\\\b')")];
        for (const text of [world!.orderNumber, (world as unknown as { buyerEmail?: string }).buyerEmail, world!.bookingId].filter((t): t is string => !!t)) masks.push(page.getByText(text));
        let visual: Findings = [];
        try { await expect(page).toHaveScreenshot(`${role}-${slug(spec.pattern)}.png`, { fullPage: true, mask: masks, maxDiffPixelRatio: 0.02 }); }
        catch (e) {
          // eslint-disable-next-line no-control-regex -- strips the terminal colour codes Playwright puts into its messages
          const msg = String(e).replace(/\u001b\[[0-9;]*m/g, "");   // without the terminal colours
          if (/writing actual|snapshot doesn't exist/i.test(msg)) info.annotations.push({ type: "baseline-written", description: `${role}-${slug(spec.pattern)}.png` });   // the first run on a runner: the baseline is created, not compared
          else visual = [`screenshot differs from the baseline: ${msg.split("\n")[0]!.slice(0, 160)}`];
        }
        found.visual = visual;

        // click everything (the shell once, on the home page)
        const clicks = await clickEverything(page, url!, isChromium ? 12 : 6, "main");
        found.clicks = clicks.findings;
        if (spec.pattern === "/") found.clicks.push(...(await clickEverything(page, url!, isChromium ? 14 : 6, SHELL_SCOPE)).findings);
        watcher.stop();
        found.http = watcher.http;
        found.console = [...watcher.consoleErrors, ...watcher.pageErrors];

        const failures = Object.entries(found).filter(([, v]) => v.length);
        record(info, { role, pattern: spec.pattern, url, status, ms: Date.now() - t0, shot, clicked: clicks.clicked, deniedSkipped: clicks.skippedDenied, found, ok: failures.length === 0 });
        for (const [category, list] of Object.entries(found)) expect.soft(list, `${category} on ${role} ${url}`).toEqual([]);
      });
    }
  });
}
