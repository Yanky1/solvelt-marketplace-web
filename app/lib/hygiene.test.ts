import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Trojan Source" guard: raw bidi controls, zero-width and other invisible characters inside source files can make code
 * read differently from how it runs, and hide inside test strings. Write them as escape sequences instead.
 * (ZWJ U+200D and ZWNJ U+200C are not flagged here because real names need them, but tests escape them too.)
 */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is being looked for
const HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/u;
const ROOT = process.cwd();
const SKIP = new Set(["node_modules", "build", ".react-router", ".git", "playwright-report", "test-results", "screenshots"]);
const EXT = /\.(ts|tsx|js|mjs|cjs|css|md|json|yml|yaml|html)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.test(name) && name !== "package-lock.json") out.push(p);
  }
  return out;
}

describe("source hygiene", () => {
  it("has no raw hidden or bidirectional characters in any source file", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const m = HIDDEN.exec(line);
        if (m) offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1} U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
      });
    }
    expect(offenders).toEqual([]);
  });
  it("the guard itself detects what it should", () => {
    for (const ch of ["\u202e", "\u200b", "\u2028", "\ufeff", "\u0007", "\u{e0041}"]) expect(HIDDEN.test(`a${ch}b`)).toBe(true);
    for (const ch of ["\u200d", "\u200c", "\u05e9\u05b8", "e\u0301", " ", "\t"]) expect(HIDDEN.test(`a${ch}b`)).toBe(false);
  });
});
