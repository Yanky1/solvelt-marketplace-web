import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PAGES } from "./pages";

for (const theme of ["light", "dark"] as const) {
  for (const path of PAGES) {
    test(`axe: ${path} (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      // axe stays green even if a theme block is deleted, so assert the real palette is applied.
      await expect(page.locator("body")).toHaveCSS("background-color", theme === "dark" ? "rgb(7, 22, 18)" : "rgb(244, 246, 244)");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations, JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 1)).toEqual([]);
    });
  }
}

for (const scheme of ["dark", "light"] as const) {
  for (const path of PAGES) {
    test(`axe: ${path} (OS ${scheme}, no cookie)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
      await expect(page.locator("body")).toHaveCSS("background-color", scheme === "dark" ? "rgb(7, 22, 18)" : "rgb(244, 246, 244)");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }
}

test("an explicit light choice wins over OS dark", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "solvelt_theme", value: "light", url: baseURL! }]);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(244, 246, 244)");
});

test("placeholder text uses the muted token in dark mode (axe does not check placeholders)", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "solvelt_theme", value: "dark", url: baseURL! }]);
  await page.goto("/");
  const color = await page.locator("#site-search").evaluate((el) => getComputedStyle(el, "::placeholder").color);
  expect(color).toBe("rgb(184, 203, 192)"); // --muted (#b8cbc0)
});

test("focus ring on the hero is the gold ring, not the dark green one (light mode)", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "solvelt_theme", value: "light", url: baseURL! }]);
  await page.goto("/");
  await page.getByRole("link", { name: "Browse categories" }).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Browse categories" })).toHaveCSS("outline-color", "rgb(231, 198, 85)");
});
