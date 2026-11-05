import type { BrandCardData } from "./search";

export interface BrandGroup { letter: string; brands: BrandCardData[] }

/** The letter a brand is filed under: its first letter without accents, upper case; anything that is not A to Z (a digit, Hebrew, an emoji) goes under "#". */
export function letterOf(name: string): string {
  const first = name.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

/** Brands grouped A to Z (a "#" group last), each group in name order. A stable order, so the page is the same on every request. */
export function groupBrands(brands: readonly BrandCardData[]): BrandGroup[] {
  const sorted = [...brands].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) || a.slug.localeCompare(b.slug));
  const groups = new Map<string, BrandCardData[]>();
  for (const b of sorted) { const l = letterOf(b.name); const g = groups.get(l); if (g) g.push(b); else groups.set(l, [b]); }
  return [...groups.entries()].sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b))).map(([letter, list]) => ({ letter, brands: list }));
}
