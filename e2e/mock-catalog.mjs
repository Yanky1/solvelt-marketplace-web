// Mock of the public catalog API for E2E (API repo docs/API.md "Catalog"). Small on purpose; the shapes are the real ones.
import { createHash } from "node:crypto";

export const gid = (name) => { const h = createHash("md5").update(`solvelt-mock:${name}`).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };

const categories = [
  { slug: "food-drink", name: "Food & Drink", parent: null }, { slug: "bakery", name: "Bakery", parent: "food-drink" }, { slug: "wine-spirits", name: "Wine & Grape Juice", parent: "food-drink" },
  { slug: "home-judaica", name: "Home & Judaica", parent: null }, { slug: "candlesticks", name: "Candles & Candlesticks", parent: "home-judaica" },
  { slug: "services", name: "Services", parent: null }, { slug: "cleaning", name: "Cleaning", parent: "services" },
];
const brands = [
  { slug: "challah-corner", name: "Challah Corner", seller: "mazel" }, { slug: "brooklyn-judaica", name: "Brooklyn Judaica", seller: "judaica" },
  { slug: "hudson-home-pros", name: "Hudson Home Pros", seller: "hudson" }, { slug: "hudson-valley-vines", name: "Hudson Valley Vines", seller: "cellar" },
];
const sellers = { mazel: "Mazel Bakery", judaica: "Brooklyn Judaica", hudson: "Hudson Home Services", cellar: "Kosher Wine Cellar" };

// slug, title, type, brand, category, summary, description, variants [name, cents, wasCents|null, available], attrs, faqs, images
const rows = [
  ["classic-braided-challah", "Classic Braided Challah", "product", "challah-corner", "bakery", "Hand-braided, baked fresh every Thursday.",
    "A soft, golden challah braided by hand and baked fresh every Thursday.\n\nOrder by Wednesday night for Friday pickup or local delivery.",
    [["Small", 650, 750, true], ["Large", 950, null, true], ["Extra large", 1250, null, false]],
    [["kosher-certification", "OU"], ["kosher-status", "pareve"], ["weight", "1 lb"], ["delivery", "ships"], ["delivery", "local"]],
    [["Is this kosher?", "Yes. It is certified by OU; the certification mark is on the packaging."], ["How is it shipped?", "Packed and shipped by the seller; delivery times are shown at checkout."]], 3],
  ["silver-plated-shabbat-candlesticks", "Silver-Plated Shabbat Candlesticks", "product", "brooklyn-judaica", "candlesticks", "Classic pair, 10 inches tall.",
    "A classic pair of silver-plated candlesticks.", [["Pair", 8900, 10000, true]], [["material", "silver plated"], ["height", "10 in"], ["delivery", "ships"]], [], 2],
  ["cabernet-sauvignon-mevushal", "Cabernet Sauvignon, Mevushal", "product", "hudson-valley-vines", "wine-spirits", "Medium-bodied red from the Hudson Valley.",
    "Medium-bodied, with dark cherry and a soft finish.", [["750 ml", 2499, null, true], ["1.5 L", 4600, null, true]], [["kosher-certification", "OU"], ["kosher-status", "mevushal"], ["delivery", "ships"]], [], 1],
  ["sold-out-honey-cake", "Honey Cake for Rosh Hashanah", "product", "challah-corner", "bakery", "Moist spiced honey cake, baked to order.",
    "Moist, spiced honey cake.", [["Loaf", 1550, null, false]], [["kosher-certification", "OU"], ["delivery", "ships"]], [], 0],
  ["deep-house-cleaning", "Deep House Cleaning", "service", "hudson-home-pros", "cleaning", "Top-to-bottom clean by a two-person team.",
    "Top-to-bottom clean by a two-person team.\n\nBook a time that suits you; the seller confirms the details after your request.",
    [["2 bedrooms", 18000, 20000, true], ["3 bedrooms", 24000, null, true]], [["service-area", "Brooklyn, Manhattan, Queens"], ["duration", "4 to 6 hours"], ["insured", "yes"], ["delivery", "at-home"]], [["What areas do you serve?", "Brooklyn, Manhattan, Queens"]], 3],
];
const unlisted = new Set(["retired-spice-gift-set"]); // 410
const iso = (d) => new Date(Date.UTC(2026, 8, 1 + d, 9)).toISOString();

const list = rows.map(([slug, title, type, brand, category, summary, description, variants, attrs, faqs, nImages], i) => {
  const b = brands.find((x) => x.slug === brand);
  const catPath = []; for (let c = categories.find((x) => x.slug === category); c; c = c.parent && categories.find((x) => x.slug === c.parent)) catPath.unshift({ id: gid(`cat:${c.slug}`), slug: c.slug, name: c.name });
  const vs = variants.map(([name, cents, was, ok], j) => ({ id: gid(`v:${slug}:${j}`), name, priceCents: cents, compareAtCents: was, available: ok }));
  const buyable = vs.some((v) => v.available) ? vs.filter((v) => v.available) : vs;
  return {
    id: gid(`l:${slug}`), slug, type, title, summary, description,
    priceFromCents: Math.min(...buyable.map((v) => v.priceCents)), priceToCents: Math.max(...buyable.map((v) => v.priceCents)),
    compareAtFromCents: buyable.map((v) => v.compareAtCents).filter((x) => x && x > Math.min(...buyable.map((y) => y.priceCents))).sort((a, c) => a - c)[0] ?? null,
    currency: "USD", available: vs.some((v) => v.available),
    brand: { id: gid(`b:${brand}`), slug: brand, name: b.name }, seller: { id: gid(`s:${b.seller}`), displayName: sellers[b.seller] },
    categoryPath: catPath, variants: vs,
    images: Array.from({ length: nImages }, (_, k) => ({ id: gid(`i:${slug}:${k}`), width: k === 0 ? 1200 : 1600, height: 1200, alt: `${title}, photo ${k + 1}` })),
    attributes: attrs.map(([key, value]) => ({ key, value })), faqs: faqs.map(([question, answer]) => ({ question, answer })),
    createdAt: iso(i), updatedAt: iso(i + 3),
  };
});

const card = (l) => ({
  id: l.id, slug: l.slug, type: l.type, title: l.title, summary: l.summary, priceFromCents: l.priceFromCents, priceToCents: l.priceToCents, compareAtFromCents: l.compareAtFromCents,
  currency: l.currency, available: l.available, brand: l.brand, seller: l.seller, category: l.categoryPath.at(-1), image: l.images[0] ?? null,
});

const descendants = (slug) => { const out = [slug]; for (let i = 0; i < out.length; i++) for (const c of categories) if (c.parent === out[i] && !out.includes(c.slug)) out.push(c.slug); return out; };

/** @returns {{status:number, body:unknown, headers?:Record<string,string>}|null} */
export function catalogResponse(path, url) {
  const ok = (body) => ({ status: 200, body, headers: { "Cache-Control": "public, max-age=5" } });
  const err = (status, code) => ({ status, body: { code, message: code }, headers: { "Cache-Control": "no-store" } });
  let m;
  if ((m = /^\/api\/v1\/catalog\/listings\/([^/]+)$/.exec(path))) {
    const key = decodeURIComponent(m[1]);
    if (unlisted.has(key)) return err(410, "gone");
    const l = list.find((x) => x.slug === key || x.id === key);
    return l ? ok(l) : err(404, "not_found");
  }
  if (path === "/api/v1/catalog/listings") {
    const q = url.searchParams, term = (q.get("q") ?? "").toLowerCase().trim();
    let items = list.filter((l) => (!q.get("type") || l.type === q.get("type")) && (!q.get("brand") || l.brand.slug === q.get("brand"))
      && (!q.get("category") || descendants(q.get("category")).includes(l.categoryPath.at(-1).slug)) && (!term || `${l.title} ${l.summary} ${l.brand.name}`.toLowerCase().includes(term)));
    const sort = q.get("sort") ?? (term ? "relevance" : "newest");
    if (sort === "price_asc") items.sort((a, b) => a.priceFromCents - b.priceFromCents); else if (sort === "price_desc") items.sort((a, b) => b.priceFromCents - a.priceFromCents);
    else if (sort === "title") items.sort((a, b) => a.title.localeCompare(b.title)); else items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = Number(q.get("page") ?? 1), size = Number(q.get("pageSize") ?? 24);
    return ok({ items: items.slice((page - 1) * size, page * size).map(card), page, pageSize: size, total: items.length, totalPages: Math.ceil(items.length / size), nextCursor: null });
  }
  if (path === "/api/v1/catalog/categories") {
    const build = (parent) => categories.filter((c) => c.parent === parent).map((c) => {
      const children = build(c.slug), n = list.filter((l) => l.categoryPath.at(-1).slug === c.slug).length;
      return { id: gid(`cat:${c.slug}`), slug: c.slug, name: c.name, listingCount: n + children.reduce((s, k) => s + k.listingCount, 0), children };
    }).filter((n) => n.listingCount > 0);
    return ok(build(null));
  }
  if (path === "/api/v1/catalog/brands") return ok(brands.map((b) => ({ id: gid(`b:${b.slug}`), slug: b.slug, name: b.name, seller: { id: gid(`s:${b.seller}`), displayName: sellers[b.seller] }, logoImageId: null, listingCount: list.filter((l) => l.brand.slug === b.slug).length })).filter((b) => b.listingCount > 0));
  return null;
}
