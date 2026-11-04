import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PAGES } from "./pages";

for (const theme of ["light", "dark"] as const) {
  for (const path of PAGES) {
    test(`axe: ${path} (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations, JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 1)).toEqual([]);
    });
  }
}
