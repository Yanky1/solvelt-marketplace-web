import AxeBuilder from "@axe-core/playwright";
import type { Page, Response } from "@playwright/test";

/** What a page check found: a short, stable text per finding (it ends up in the report and in an issue). */
export type Findings = string[];

/**
 * Things the sweep never clicks (decision M8W-07): anything that deletes, removes, locks, refunds, retries, signs out, disables, revokes, pays or sends. The match is on the accessible name,
 * the visible text, the link target and the form action: an explicit denylist, nothing "looks safe" by default. A new destructive button must be added here when it is added to the site.
 */
export const DENY = /\b(delete|remove|erase|discard|lock|unlock|refund|retry|re-?send|sign[ -]?out|log[ -]?out|disable|revoke|deactivate|cancel (order|booking)|place order|pay\b|pay now|reveal|report|purge|clear all|reset)\b|sign-out|\/remove|\/delete|privacy\/export|calendar\.ics/i;

/** Responses that are not an error on this page: the page's own expected status, and nothing else (a 4xx on a sub-request is a finding). */
const HARNESS_CSP = /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy\.$/;

export function watchPage(page: Page, expectedMain: number[]) {
  const http: Findings = [], consoleErrors: Findings = [], pageErrors: Findings = [];
  const main = { url: "", status: 0 };
  // Where each console error came from (issue #3 diagnosis, M8W-08): the step the sweep was in, the script or page that reported it, and the page's URL at that moment.
  let phase = "load";
  const sources: string[] = [];
  const webkit = page.context().browser()?.browserType().name() === "webkit";
  let suppressed = 0;
  const onResponse = (r: Response) => {
    const u = r.url();
    if (/\/error-ref$/.test(new URL(u).pathname)) return;      // the error page asks for its reference; an answer there is not a finding
    if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) { main.url = u; main.status = r.status(); if (expectedMain.includes(r.status()) && r.status() < 500) return; }
    if (r.status() >= 400 && !(r.request().isNavigationRequest() && expectedMain.includes(r.status()))) http.push(`${r.status()} ${r.request().method()} ${new URL(u).pathname}`);
  };
  page.on("response", onResponse);
  page.on("console", (m) => {
    if (m.type() !== "error" || /Failed to load resource/.test(m.text())) return;
    // Playwright's own screenshot machinery (animations, caret, masks) makes WebKit report this one message while it takes or compares a screenshot, and the page's own CSP-violation
    // events do not see it (issue #3, M8W-08). Exactly that message, in WebKit, in those two steps; counted and written to the record, never silently dropped.
    if (webkit && (phase === "screenshot" || phase === "compare") && HARNESS_CSP.test(m.text())) { suppressed++; return; }
    consoleErrors.push(m.text().slice(0, 240));
    const loc = m.location();
    if (sources.length < 20) sources.push(`[${phase}] ${loc.url || "(no url)"}:${loc.lineNumber} on ${page.url()}: ${m.text().slice(0, 160)}`);
  });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 240)));
  return { http, consoleErrors, pageErrors, main, sources, suppressed: () => suppressed, setPhase: (p: string) => { phase = p; }, stop: () => page.off("response", onResponse) };
}

/** Listens for CSP violations inside the page (securitypolicyviolation: which directive, what was blocked, which element) from the first script on; read back with cspEvents(). Diagnosis only. */
export async function listenForCspViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    // who writes a style onto a <select>: the call stack of setAttribute("style"), of style.cssText and of style.setProperty on it (diagnosis only)
    const note = (what: string, el: unknown) => {
      const n = el as Element | null;
      if (!n || n.nodeName !== "SELECT" || w.__csp.length >= 10) return;
      w.__csp.push(`WRITE ${what} on select#${n.id}: ${(new Error().stack ?? "").split("\n").slice(1, 4).map((l) => l.trim().slice(0, 90)).join(" < ")}`);
    };
    const setAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (this: Element, name: string, value: string) { if (String(name).toLowerCase() === "style") note("setAttribute", this); return setAttr.call(this, name, value); };
    new MutationObserver((list) => { for (const m of list) if (m.attributeName === "style" && m.target.nodeName === "SELECT" && w.__csp.length < 10) w.__csp.push(`STYLE ATTR on select#${(m.target as Element).id} = "${((m.target as Element).getAttribute("style") ?? "").slice(0, 80)}"`); }).observe(document, { attributes: true, subtree: true, attributeFilter: ["style"] });
    document.addEventListener("securitypolicyviolation", (e) => {
      const t = e.target as Element | null;
      const where = t && t.nodeName ? `${t.nodeName.toLowerCase()}${t.id ? "#" + t.id : ""}${typeof t.className === "string" && t.className ? "." + t.className.split(" ")[0] : ""}` : "document";
      if (w.__csp.length < 10) w.__csp.push(`${e.effectiveDirective} blocked=${e.blockedURI} on ${where} (${e.sourceFile || "no file"}:${e.lineNumber})`);
    }, true);
  });
}
export async function cspEvents(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
}

/** What styles the document has right now: <style> and <link rel=stylesheet> elements, constructed (adopted) style sheets and elements with a style attribute. Written to the record, never a finding. */
export async function styleSnapshot(page: Page, at: string): Promise<string> {
  return page.evaluate((where) => {
    const sheets = [...document.querySelectorAll("style,link[rel=stylesheet]")].map((e) => e.tagName.toLowerCase() === "style" ? `<style${e.getAttribute("nonce") ? " nonce" : ""}> ${(e.textContent ?? "").replace(/\s+/g, " ").slice(0, 60)}` : `<link> ${e.getAttribute("href")}`);
    return `${where}: ${sheets.length} sheet elements [${sheets.join(" | ").slice(0, 400)}], adopted ${document.adoptedStyleSheets?.length ?? 0}, [style] ${document.querySelectorAll("[style]").length}`;
  }, at).catch((e) => `${at}: snapshot failed ${String(e).slice(0, 80)}`);
}

/** Waits until the page is hydrated (the site marks `html[data-hydrated=true]`), without waiting for "network idle". */
export async function settle(page: Page) {
  await page.waitForSelector("html[data-hydrated=true]", { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(150);
}

// ---- layout ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** No horizontal scroll, nothing wider than the viewport, no clipped or overlapping text, tap targets of at least 24 x 24 CSS px (WCAG 2.5.8; inline links in running text are exempt). */
export async function layoutFindings(page: Page): Promise<{ layout: Findings; tap: Findings }> {
  return page.evaluate(() => {
    const layout: string[] = [], tap: string[] = [];
    const vw = document.documentElement.clientWidth;
    const label = (el: Element) => {
      const t = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("name") || el.getAttribute("href") || "").replace(/\s+/g, " ").trim().slice(0, 40);
      return `<${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}> "${t}"`;
    };
    const visible = (el: Element) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0 && s.opacity !== "0" && (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : true); };
    const inScroller = (el: Element) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth) return true; } return false; };
    const srOnly = (el: Element) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return (s.position === "absolute" || s.position === "fixed") && (r.width <= 1 || r.height <= 1 || s.clip !== "auto" || s.clipPath !== "none"); };

    if (document.documentElement.scrollWidth > vw + 1) layout.push(`horizontal scroll: the page is ${document.documentElement.scrollWidth}px wide in a ${vw}px viewport`);

    const all = Array.from(document.body.querySelectorAll("*")).filter((el) => visible(el) && !srOnly(el));
    let wide = 0;
    for (const el of all) {
      if (["HTML", "BODY", "SCRIPT", "STYLE"].includes(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && !inScroller(el) && getComputedStyle(el).position !== "fixed") { if (wide++ < 5) layout.push(`wider than the viewport: ${label(el)} spans ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}px`); }
    }
    if (wide > 5) layout.push(`... and ${wide - 5} more elements wider than the viewport`);

    // clipped text: overflow hidden or clip with content wider than the box, and no ellipsis to say so
    let clipped = 0;
    for (const el of all) {
      const s = getComputedStyle(el);
      if (!(s.overflowX === "hidden" || s.overflowX === "clip")) continue;
      if (!(el as HTMLElement).innerText?.trim()) continue;
      if (el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== "ellipsis" && !inScroller(el)) { if (clipped++ < 5) layout.push(`clipped text: ${label(el)} is ${el.scrollWidth}px of content in ${el.clientWidth}px`); }
    }

    // overlapping text: two text-bearing leaf boxes that cover each other (neither inside the other)
    const leaves = all.filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 1 && !["OPTION", "SCRIPT", "STYLE"].includes(el.tagName)).slice(0, 600);
    const rects = leaves.map((el) => ({ el, r: el.getBoundingClientRect() }));
    let overlaps = 0;
    for (let i = 0; i < rects.length && overlaps < 5; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!, b = rects[j]!;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w <= 2 || h <= 2) continue;
        const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
        if (smaller > 0 && (w * h) / smaller > 0.35) { layout.push(`overlapping text: ${label(a.el)} and ${label(b.el)}`); overlaps++; break; }
      }
    }

    // tap targets
    const targets = Array.from(document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem]")).filter(visible);
    let small = 0;
    for (const el of targets) {
      if (srOnly(el)) continue;
      const s = getComputedStyle(el);
      const inline = el.tagName === "A" && s.display === "inline" && !!el.closest("p, li, dd, td, span, label");   // WCAG 2.5.8: an inline link in a sentence is exempt
      if (inline) continue;
      if ((el as HTMLInputElement).type === "radio" || (el as HTMLInputElement).type === "checkbox") { const lab = (el as HTMLInputElement).labels?.[0]; if (lab) { const lr = lab.getBoundingClientRect(); if (lr.width >= 24 && lr.height >= 24) continue; } }
      const r = el.getBoundingClientRect();
      if (r.width < 24 - 0.5 || r.height < 24 - 0.5) { if (small++ < 8) tap.push(`tap target ${Math.round(r.width)}x${Math.round(r.height)} (min 24x24): ${label(el)}`); }
    }
    if (small > 8) tap.push(`... and ${small - 8} more small tap targets`);
    return { layout, tap };
  });
}

// ---- accessibility -------------------------------------------------------------------------------------------------------------------------------------------------------------------
export async function axeFindings(page: Page): Promise<Findings> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.map((v) => `axe ${v.id} (${v.impact}): ${v.help} [${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"}; first: ${v.nodes[0]?.target.join(" ").slice(0, 100)}]`);
}

/** Tab through the page: every interactive element in the page must be reached (a radio group is one stop), and each must show a focus indicator (outline, ring or shadow) while focused. */
export async function keyboardFindings(page: Page): Promise<Findings> {
  const out: Findings = [];
  // every candidate gets its own number, so two buttons with the same name (the theme buttons share `name=theme`) are two stops, not one
  const idFn = `(el) => el.getAttribute("data-sweep-k") ?? (el.tagName + "|" + (el.id || ""))`;
  const expected: Array<{ id: string; label: string }> = await page.evaluate((src) => {
    const id = eval(src) as (el: Element) => string;
    const vis = (el: Element) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0 && !el.closest("[inert],[aria-hidden=true]") && (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : true); };
    const groups = new Set<string>();
    const list: Array<{ id: string; label: string }> = [];
    let n = 0;
    document.querySelectorAll("[data-sweep-k]").forEach((e) => e.removeAttribute("data-sweep-k"));
    for (const el of Array.from(document.querySelectorAll("a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])"))) {
      if (!vis(el) || el.getAttribute("tabindex") === "-1") continue;
      if ((el as HTMLInputElement).type === "radio") { const g = (el as HTMLInputElement).name; if (groups.has(g)) { el.setAttribute("data-sweep-k", "radio:" + g); continue; } groups.add(g); }
      el.setAttribute("data-sweep-k", (el as HTMLInputElement).type === "radio" ? "radio:" + (el as HTMLInputElement).name : "k" + n++);
      list.push({ id: id(el), label: `<${el.tagName.toLowerCase()}> "${(el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("name") || el.getAttribute("href") || "").replace(/\s+/g, " ").trim().slice(0, 40)}"` });
    }
    return list;
  }, idFn);
  const seen = new Set<string>();
  let noIndicator = 0;
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const limit = Math.min(expected.length + 15, 200);
  let stale = 0;
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate((src) => {
      const id = eval(src) as (el: Element) => string;
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== "none" && s.boxShadow !== "");
      const r = el.getBoundingClientRect();
      return { id: id(el), ring, label: `<${el.tagName.toLowerCase()}> "${(el.getAttribute("aria-label") || el.innerText || el.getAttribute("name") || "").replace(/\s+/g, " ").trim().slice(0, 40)}"`, hidden: r.width === 0 || r.height === 0 };
    }, idFn);
    if (!info) { if (++stale > 3) break; continue; }
    if (seen.has(info.id)) { if (++stale > 3) break; continue; }
    stale = 0;
    seen.add(info.id);
    if (!info.ring && !info.hidden) { if (noIndicator++ < 6) out.push(`no visible focus indicator on ${info.label}`); }
  }
  if (noIndicator > 6) out.push(`... and ${noIndicator - 6} more elements without a focus indicator`);
  const missing = expected.filter((e) => !seen.has(e.id));
  if (missing.length) out.push(`keyboard reach: Tab did not reach ${missing.length} of ${expected.length} interactive elements, e.g. ${missing.slice(0, 4).map((m) => m.label).join(", ")}`);
  return out;
}

// ---- click everything -------------------------------------------------------------------------------------------------------------------------------------------------------------
interface Candidate { i: number; name: string; tag: string; href: string | null; skip: string | null }

async function tagCandidates(page: Page, scope: string): Promise<Candidate[]> {
  return page.evaluate((scopeSel) => {
    const root = document.querySelector(scopeSel) ?? document.body;
    const vis = (el: Element) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0 && (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : true); };
    const els = Array.from(root.querySelectorAll("a[href], button, summary, [role=button], [role=tab], input[type=checkbox], input[type=radio]")).filter((el) => vis(el) && !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true");
    document.querySelectorAll("[data-sweep-i]").forEach((e) => e.removeAttribute("data-sweep-i"));
    return els.map((el, i) => {
      el.setAttribute("data-sweep-i", String(i));
      const form = el.closest("form");
      const name = [el.getAttribute("aria-label"), (el as HTMLElement).innerText, el.getAttribute("title"), el.getAttribute("name"), (el as HTMLInputElement).value, form?.getAttribute("action") ?? ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 80);
      const submit = (el.tagName === "BUTTON" && ((el as HTMLButtonElement).type === "submit")) || (el.tagName === "INPUT" && (el as HTMLInputElement).type === "submit");
      const post = !!form && (form.getAttribute("method") ?? "get").toLowerCase() !== "get";
      const skipLink = el.tagName === "A" && (el.getAttribute("href") ?? "").startsWith("#");
      return { i, name, tag: el.tagName.toLowerCase(), href: el.getAttribute("href"), skip: (submit && post) ? "a form submit (a POST): the e2e suites post the forms; the sweep does not" : skipLink ? "an in-page anchor (a skip link is shown on focus: the keyboard check reaches it)" : null };
    });
  }, scope);
}

const fingerprint = (page: Page) => page.evaluate(() => `${location.href}|${document.body.innerText.length}|${document.querySelectorAll("*").length}|${document.activeElement?.tagName}|${Array.from(document.querySelectorAll("[aria-expanded],[aria-pressed],[aria-selected],input[type=checkbox],input[type=radio],details")).map((e) => (e as HTMLInputElement).checked ?? e.getAttribute("aria-expanded") ?? e.getAttribute("aria-pressed") ?? e.getAttribute("aria-selected") ?? (e as HTMLDetailsElement).open).join(",")}|${!!document.querySelector("dialog[open],[role=dialog]")}`);

/**
 * Clicks every visible, enabled clickable in `main` (up to `cap`), except the denylist, each from a fresh load of the page, and checks: something happened; a dialog that opens closes with Esc and with
 * its close button. Console errors and bad responses are collected by watchPage around the whole run.
 */
export async function clickEverything(page: Page, url: string, cap: number, scope = "main"): Promise<{ findings: Findings; clicked: number; skippedDenied: number }> {
  const findings: Findings = [];
  const cands = await tagCandidates(page, scope);
  const seen = new Set<string>();
  const todo: Candidate[] = [];
  let skippedDenied = 0;
  for (const c of cands) {
    const key = `${c.tag}|${c.name}|${c.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.skip) continue;
    if (DENY.test(c.name) || (c.href && DENY.test(c.href))) { skippedDenied++; continue; }
    if (c.href && (/^(mailto|tel|javascript):/i.test(c.href) || /^https?:\/\//i.test(c.href) && !c.href.startsWith(new URL(url, "http://x").origin))) continue;   // other sites and mail links are not ours to click
    todo.push(c);
  }
  let clicked = 0;
  for (const c of todo.slice(0, cap)) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await settle(page);
    await tagCandidates(page, scope);
    const target = page.locator(`[data-sweep-i="${c.i}"]`);
    if (!(await target.count())) continue;
    const before = await fingerprint(page);
    try { await target.first().click({ timeout: 4_000 }); } catch (e) { findings.push(`click failed: ${c.tag} "${c.name.slice(0, 50)}": ${String(e).split("\n")[0]!.slice(0, 120)}`); continue; }
    clicked++;
    await page.waitForTimeout(350);
    const after = await fingerprint(page).catch(() => "navigated");
    if (after === before && c.tag !== "input") findings.push(`nothing happened: ${c.tag} "${c.name.slice(0, 50)}"${c.href ? ` -> ${c.href}` : ""}`);
    if (await page.locator("dialog[open], [role=dialog]").first().isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      if (await page.locator("dialog[open], [role=dialog]").first().isVisible().catch(() => false)) findings.push(`a dialog opened by "${c.name.slice(0, 40)}" does not close with Esc`);
      else {
        await target.first().click({ timeout: 4_000 }).catch(() => {});
        await page.waitForTimeout(300);
        const closer = page.locator("dialog[open], [role=dialog]").first().getByRole("button", { name: /close|cancel|dismiss|×|x$/i }).first();
        if (await closer.count()) { await closer.click({ timeout: 3_000 }).catch(() => {}); await page.waitForTimeout(250); if (await page.locator("dialog[open], [role=dialog]").first().isVisible().catch(() => false)) findings.push(`a dialog opened by "${c.name.slice(0, 40)}" does not close with its close button`); }
        else findings.push(`a dialog opened by "${c.name.slice(0, 40)}" has no close button`);
      }
    }
  }
  return { findings, clicked, skippedDenied };
}

/** The shell (header, footer, navigation) is clicked once per role and viewport, on the home page (scope "body"), not on every page. */
export const SHELL_SCOPE = "body";
