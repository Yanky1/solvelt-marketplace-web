import { describe, expect, it } from "vitest";
import { groupBrands, letterOf } from "./brands";
import type { BrandCardData } from "./search";

const b = (name: string, slug = name.toLowerCase().replace(/\W+/g, "-")): BrandCardData => ({ id: slug, slug, name, logoImageId: null, listingCount: 1, seller: { id: "s", displayName: "S" } });

describe("letterOf", () => {
  it("files by the first letter without accents, upper case", () => {
    expect(letterOf("clay & co")).toBe("C");
    expect(letterOf("  Émile's")).toBe("E");
    expect(letterOf("Ōra")).toBe("O");
  });
  it("puts digits, Hebrew, symbols and the empty name under #", () => {
    for (const n of ["7 Days", "שלום", "🙂 Smile", "", "   ", "_x"]) expect(letterOf(n), n).toBe("#");
  });
});

describe("groupBrands", () => {
  it("groups A to Z with # last, each group by name, regardless of the order the API answers in", () => {
    const groups = groupBrands([b("Zed"), b("apple"), b("7 Up"), b("Avocado"), b("Écru"), b("שלום")]);
    expect(groups.map((g) => g.letter)).toEqual(["A", "E", "Z", "#"]);
    expect(groups[0]!.brands.map((x) => x.name)).toEqual(["apple", "Avocado"]);
    expect(groups[3]!.brands.map((x) => x.name).sort()).toEqual(["7 Up", "שלום"].sort());
  });
  it("is stable: names that compare equal are ordered by slug, and the input is not modified", () => {
    const input = [b("Same", "b-slug"), b("same", "a-slug")];
    const copy = [...input];
    expect(groupBrands(input)[0]!.brands.map((x) => x.slug)).toEqual(["a-slug", "b-slug"]);
    expect(input).toEqual(copy);
  });
  it("is empty for no brands", () => { expect(groupBrands([])).toEqual([]); });
});
