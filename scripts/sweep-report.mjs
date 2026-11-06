// Turns the sweep's records (sweep-out/records/*.jsonl, one line per page visit) into:
//   sweep-out/index.html   a gallery of the full-page screenshots, grouped by role and page, with the findings next to each (open it from the artifact; the images are next to it)
//   sweep-out/summary.md   the run summary (also appended to $GITHUB_STEP_SUMMARY): counts and failures by category
//   sweep-out/summary.json the same numbers for a script
// Usage: node scripts/sweep-report.mjs        (decision M8W-07)
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "sweep-out");
const dir = join(OUT, "records");
const rows = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))) : [];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const uniq = (xs) => [...new Set(xs)];
const CATEGORIES = ["status", "http", "console", "layout", "tap", "axe", "keyboard", "clicks", "visual"];

const failed = rows.filter((r) => !r.ok);
const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, rows.filter((r) => r.found?.[c]?.length).length]));
const pages = uniq(rows.map((r) => r.pattern)), roles = uniq(rows.map((r) => r.role)), browsers = uniq(rows.map((r) => r.browser));
const projects = uniq(rows.map((r) => r.project));
const summary = { visits: rows.length, failedVisits: failed.length, pages: pages.length, roles, browsers, projects: projects.length, widths: uniq(rows.map((r) => r.width)).sort((a, b) => a - b), byCategory };
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

// the same finding on many pages is one root cause: group by category + text (with the page-specific part of the line left in)
const groups = new Map();
for (const r of rows) for (const c of CATEGORIES) for (const f of r.found?.[c] ?? []) {
  const key = `${c}: ${f.replace(/\d+(px|x\d+)?/g, "N").slice(0, 110)}`;
  const g = groups.get(key) ?? { key, example: f, count: 0, where: new Set() };
  g.count++; g.where.add(`${r.role} ${r.pattern} @ ${r.project}`);
  groups.set(key, g);
}
const top = [...groups.values()].sort((a, b) => b.count - a.count);

// where the console errors came from (issue #3 diagnosis): by step and by reporting script, and what the document's styles looked like in one affected visit
const bySource = new Map();
for (const r of rows) for (const line of r.consoleSources ?? []) {
  const m = /^\[([^\]]+)\] (\S+?)(?::\d+)? on /.exec(line);
  const key = `${r.browser} [${m?.[1] ?? "?"}] reported by ${m?.[2] ?? "?"}`;
  bySource.set(key, (bySource.get(key) ?? 0) + 1);
}
const byCsp = new Map();
for (const r of rows) for (const line of r.csp ?? []) { const k = `${r.browser} ${/^(WRITE|STYLE)/.test(line) ? line.slice(0, 220) : line.replace(/\(.*$/, "").trim()}`; byCsp.set(k, (byCsp.get(k) ?? 0) + 1); }
const cspLines = [...byCsp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `- ${n}x ${k}`);
const engineRows = rows.filter((r) => r.engineSelectSetAside > 0);
const engineTotal = engineRows.reduce((n, r) => n + r.engineSelectSetAside, 0);
const engineWhere = [...new Set(engineRows.map((r) => `${r.role} ${r.pattern}`))].slice(0, 20);
const suppressedTotal = rows.reduce((n, r) => n + (r.harnessSuppressed ?? 0), 0);
const sample = rows.find((r) => r.browser === "webkit" && r.found?.console?.length);
const sourceLines = [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `- ${n}x ${k}`);
const diag = (sourceLines.length || suppressedTotal || engineTotal) ? ["", `Set aside (Playwright screenshot step, WebKit): ${suppressedTotal}`, "", `Set aside (WebKit engine, select): ${engineTotal} messages in ${engineRows.length} visits${engineWhere.length ? `; pages: ${engineWhere.join(", ")}` : ""}`, "", "Where the console errors came from (first 20 per visit):", "", ...sourceLines, ...(cspLines.length ? ["", "CSP violation events seen inside the page (directive, blocked, element):", "", ...cspLines] : []), ...(sample ? ["", `One affected visit (${sample.role} ${sample.pattern} @ ${sample.project}):`, ...(sample.styles ?? []).map((x) => `- ${x}`), ...(sample.consoleSources ?? []).slice(0, 3).map((x) => `- ${x}`)] : []), ""] : [];

const md = [
  "## UI sweep",
  "",
  `**${rows.length}** page visits (${pages.length} pages x ${roles.length} roles x ${projects.length} projects: ${browsers.join(", ")}; widths ${summary.widths.join("/")}), **${failed.length}** with at least one finding.`,
  "",
  "| Category | Visits with findings |", "|---|---|",
  ...CATEGORIES.map((c) => `| ${c} | ${byCategory[c]} |`),
  "",
  `Distinct findings: **${top.length}**${top.length > 40 ? " (the 40 most frequent are listed; all are in records/)" : ""}:`,
  "",
  ...top.slice(0, 40).map((g) => `- ${g.count}x ${g.key} (e.g. ${[...g.where][0]})`),
  ...diag,
  "",
].join("\n");
writeFileSync(join(OUT, "summary.md"), md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");

const byRole = new Map();
for (const r of rows) { const k = `${r.role} ${r.pattern}`; (byRole.get(k) ?? byRole.set(k, []).get(k)).push(r); }
const html = `<!doctype html><meta charset="utf-8"><title>UI sweep</title>
<style>body{font:14px system-ui;margin:16px;background:#fafafa;color:#111}h1{margin:0 0 8px}details{margin:8px 0;background:#fff;border:1px solid #ddd;border-radius:6px;padding:6px 10px}
summary{cursor:pointer;font-weight:600}.bad summary{color:#b00020}.grid{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}figure{margin:0;width:180px}figure img{width:180px;height:140px;object-fit:cover;object-position:top;border:1px solid #ccc;background:#eee}
figcaption{font-size:11px;word-break:break-all}.f{font-size:12px;color:#b00020;margin:4px 0}code{font-size:11px}</style>
<h1>UI sweep</h1><p>${rows.length} visits, ${failed.length} with findings. Click a page to see its screenshots (one per browser, width and theme) and what was found.</p>
${[...byRole.entries()].sort().map(([k, rs]) => {
  const bad = rs.some((r) => !r.ok);
  return `<details class="${bad ? "bad" : ""}"><summary>${esc(k)} ${bad ? `(${rs.filter((r) => !r.ok).length} of ${rs.length} with findings)` : `(${rs.length} ok)`}</summary>
  ${rs.filter((r) => !r.ok).slice(0, 6).map((r) => `<div class="f"><b>${esc(r.project)}</b>: ${CATEGORIES.flatMap((c) => (r.found[c] ?? []).slice(0, 3).map((f) => `[${c}] ${esc(f)}`)).join(" | ")}</div>`).join("")}
  <div class="grid">${rs.sort((a, b) => a.project.localeCompare(b.project)).map((r) => `<figure><a href="${esc(r.shot)}"><img loading="lazy" src="${esc(r.shot)}" alt="${esc(k)} ${esc(r.project)}"></a><figcaption>${r.ok ? "" : "FINDINGS "}${esc(r.project)}</figcaption></figure>`).join("")}</div></details>`;
}).join("\n")}`;
writeFileSync(join(OUT, "index.html"), html);
console.log(md);
