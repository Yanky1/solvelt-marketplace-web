// Mock of the public catalog API for E2E (API repo docs/API.md "Catalog"). Small on purpose; the shapes are the real ones.
import { createHash } from "node:crypto";

export const gid = (name) => { const h = createHash("md5").update(`solvelt-mock:${name}`).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };

const categories = [
  { slug: "food-drink", name: "Food & Drink", parent: null }, { slug: "bakery", name: "Bakery", parent: "food-drink" }, { slug: "wine-spirits", name: "Wine & Grape Juice", parent: "food-drink" },
  { slug: "home-judaica", name: "Home & Judaica", parent: null }, { slug: "candlesticks", name: "Candles & Candlesticks", parent: "home-judaica" },
  { slug: "services", name: "Services", parent: null }, { slug: "cleaning", name: "Cleaning", parent: "services" },
  { slug: "gifts", name: "Gifts", parent: null },   // 26 generated listings: two pages at 24 per page
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
for (let n = 1; n <= 26; n++) rows.push([`gift-box-${n}`, `Gift Box ${String(n).padStart(2, "0")}`, "product", "brooklyn-judaica", "gifts", `Gift box number ${n}.`, `Gift box number ${n}.`, [["Box", 2000 + n * 100, null, true]], [["delivery", "ships"]], [], 1]);
const unlisted = new Set(["retired-spice-gift-set"]); // 410
const iso = (d) => new Date(Date.UTC(2026, 8, 1 + d, 9)).toISOString();

/** Listings the mock portal marks as demo data (feed `demo: true`). */
export const DEMO_SLUGS = new Set(["classic-braided-challah"]);

const list = rows.map(([slug, title, type, brand, category, summary, description, variants, attrs, faqs, nImages], i) => {
  const b = brands.find((x) => x.slug === brand);
  const catPath = []; for (let c = categories.find((x) => x.slug === category); c; c = c.parent && categories.find((x) => x.slug === c.parent)) catPath.unshift({ id: gid(`cat:${c.slug}`), slug: c.slug, name: c.name });
  const vs = variants.map(([name, cents, was, ok], j) => ({ id: gid(`v:${slug}:${j}`), name, priceCents: cents, compareAtCents: was, available: ok }));
  const buyable = vs.some((v) => v.available) ? vs.filter((v) => v.available) : vs;
  return {
    id: gid(`l:${slug}`), slug, type, title, summary, description,
    priceFromCents: Math.min(...buyable.map((v) => v.priceCents)), priceToCents: Math.max(...buyable.map((v) => v.priceCents)),
    compareAtFromCents: buyable.map((v) => v.compareAtCents).filter((x) => x && x > Math.min(...buyable.map((y) => y.priceCents))).sort((a, c) => a - c)[0] ?? null,
    currency: "USD", available: vs.some((v) => v.available), demo: DEMO_SLUGS.has(slug),
    brand: { id: gid(`b:${brand}`), slug: brand, name: b.name }, seller: { id: gid(`s:${b.seller}`), displayName: sellers[b.seller] },
    categoryPath: catPath, variants: vs,
    images: Array.from({ length: nImages }, (_, k) => ({ id: gid(`i:${slug}:${k}`), width: k === 0 ? 1200 : 1600, height: 1200, alt: `${title}, photo ${k + 1}` })),
    attributes: attrs.map(([key, value]) => ({ key, value })), faqs: faqs.map(([question, answer]) => ({ question, answer })),
    createdAt: iso(i), updatedAt: iso(i + 3),
  };
});

const card = (l) => ({
  id: l.id, slug: l.slug, type: l.type, title: l.title, summary: l.summary, priceFromCents: l.priceFromCents, priceToCents: l.priceToCents, compareAtFromCents: l.compareAtFromCents,
  currency: l.currency, available: l.available, demo: l.demo, brand: l.brand, seller: l.seller, category: l.categoryPath.at(-1), image: l.images[0] ?? null,
});

const descendants = (slug) => { const out = [slug]; for (let i = 0; i < out.length; i++) for (const c of categories) if (c.parent === out[i] && !out.includes(c.slug)) out.push(c.slug); return out; };


/** The category tree counting only `pool` (empty categories left out), as the API does. */
function categoryTree(pool) {
  const build = (parent) => categories.filter((c) => c.parent === parent).map((c) => {
    const children = build(c.slug), n = pool.filter((l) => l.categoryPath.at(-1).slug === c.slug).length;
    return { id: gid(`cat:${c.slug}`), slug: c.slug, name: c.name, listingCount: n + children.reduce((t, k) => t + k.listingCount, 0), children };
  }).filter((n) => n.listingCount > 0);
  return build(null);
}

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
    const words = term.split(/\s+/).filter(Boolean);
    const attrPairs = q.getAll("attr").map((x) => [x.slice(0, x.indexOf(":")), x.slice(x.indexOf(":") + 1)]);
    const multi = (name) => q.getAll(name).join(",").split(",").map((x) => x.trim()).filter(Boolean);
    const has = (l, key, values) => values.length === 0 || l.attributes.some((a) => a.key === key && values.includes(a.value));
    // every filter except the one named (a facet counts with all filters but its own, as the real API does)
    const matches = (l, except) => (except === "type" || !q.get("type") || l.type === q.get("type"))
      && (except === "brand" || !q.get("brand") || l.brand.slug === q.get("brand"))
      && (except === "category" || !q.get("category") || descendants(q.get("category")).includes(l.categoryPath.at(-1).slug))
      && (!q.get("seller") || l.seller.id === q.get("seller"))
      && (words.length === 0 || words.every((w) => `${l.title} ${l.summary} ${l.brand.name}`.toLowerCase().includes(w)))
      && (except === "price" || ((q.get("priceMin") === null || l.priceToCents >= Number(q.get("priceMin"))) && (q.get("priceMax") === null || l.priceFromCents <= Number(q.get("priceMax")))))
      && (except === "available" || q.get("available") !== "true" || l.available)
      && (except === "kosher" || has(l, "kosher-certification", multi("kosher")))
      && (except === "delivery" || has(l, "delivery", multi("delivery")))
      && attrPairs.every(([k, v]) => l.attributes.some((a) => a.key === k && a.value === v));
    if (q.get("priceMin") !== null && q.get("priceMax") !== null && Number(q.get("priceMin")) > Number(q.get("priceMax"))) return err(400, "invalid_query");
    const items = list.filter((l) => matches(l));
    const sort = q.get("sort") ?? (term ? "relevance" : "newest");
    if (sort === "price_asc") items.sort((a, b) => a.priceFromCents - b.priceFromCents); else if (sort === "price_desc") items.sort((a, b) => b.priceFromCents - a.priceFromCents);
    else if (sort === "title") items.sort((a, b) => a.title.localeCompare(b.title)); else items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = Number(q.get("page") ?? 1), size = Number(q.get("pageSize") ?? 24);
    const body = { items: items.slice((page - 1) * size, page * size).map(card), page, pageSize: size, total: items.length, totalPages: Math.ceil(items.length / size), nextCursor: null };
    if (q.get("facets") === "true") {
      const count = (pool, pick) => { const m = new Map(); for (const l of pool) for (const v of new Set(pick(l))) m.set(v, (m.get(v) ?? 0) + 1); return m; };
      const attrFacet = (key, except) => [...count(list.filter((l) => matches(l, except)), (l) => l.attributes.filter((a) => a.key === key).map((a) => a.value))].map(([value, c]) => ({ value, count: c })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
      const priced = list.filter((l) => matches(l, "price"));
      body.facets = {
        categories: [], types: [...count(list.filter((l) => matches(l, "type")), (l) => [l.type])].map(([value, c]) => ({ value, count: c })),
        brands: [...count(list.filter((l) => matches(l, "brand")), (l) => [l.brand.slug])].map(([slug, c]) => ({ id: gid(`b:${slug}`), slug, name: brands.find((b) => b.slug === slug).name, count: c })),
        sellers: [], available: list.filter((l) => matches(l, "available") && l.available).length,
        price: priced.length ? { minCents: Math.min(...priced.map((l) => l.priceFromCents)), maxCents: Math.max(...priced.map((l) => l.priceToCents)) } : null,
        attributes: { "kosher-certification": attrFacet("kosher-certification", "kosher"), "kosher-status": attrFacet("kosher-status"), delivery: attrFacet("delivery", "delivery") },
      };
      body.facets.categories = categoryTree(list.filter((l) => matches(l, "category")));
    }
    return ok(body);
  }
  if (path === "/api/v1/catalog/suggest") {
    const words = (url.searchParams.get("q") ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    const last = words.at(-1) ?? "";
    if (last.length < 2) return ok({ query: url.searchParams.get("q") ?? "", suggestions: [] });
    const starts = (name) => name.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith(last));
    const suggestions = [
      ...list.filter((l) => words.every((w) => l.title.toLowerCase().split(/[^a-z0-9]+/).some((t) => t.startsWith(w)))).slice(0, 5).map((l) => ({ kind: "listing", text: l.title, slug: l.slug })),
      ...brands.filter((b) => starts(b.name) && list.some((l) => l.brand.slug === b.slug)).slice(0, 3).map((b) => ({ kind: "brand", text: b.name, slug: b.slug })),
      ...categories.filter((c) => starts(c.name)).slice(0, 3).map((c) => ({ kind: "category", text: c.name, slug: c.slug })),
    ];
    return ok({ query: url.searchParams.get("q") ?? "", suggestions });
  }
  if ((m = /^\/api\/v1\/catalog\/sitemap\/(listings|categories|brands)$/.exec(path))) {
    const kind = m[1], page = Number(url.searchParams.get("page") ?? 1), size = Number(url.searchParams.get("pageSize") ?? 1000);
    const all = kind === "listings" ? list.map((l) => ({ key: l.slug, lastModified: l.updatedAt }))
      : kind === "categories" ? categories.filter((c) => list.some((l) => l.categoryPath.some((p) => p.slug === c.slug))).map((c) => ({ key: c.slug, lastModified: "2026-09-10T00:00:00+00:00" }))
      : brands.filter((b) => list.some((l) => l.brand.slug === b.slug)).map((b) => ({ key: b.slug, lastModified: "2026-09-11T00:00:00+00:00" }));
    return ok({ kind, page, pageSize: size, total: all.length, totalPages: Math.ceil(all.length / size), items: all.slice((page - 1) * size, page * size) });
  }
  let sm;
  if ((sm = /^\/api\/v1\/catalog\/brands\/([^/]+)$/.exec(path))) {
    const key = decodeURIComponent(sm[1]);
    const b = brands.find((x) => x.slug === key || gid(`b:${x.slug}`) === key);
    const pool = b ? list.filter((l) => l.brand.slug === b.slug) : [];
    if (!b || pool.length === 0) return err(404, "not_found");
    return ok({ id: gid(`b:${b.slug}`), slug: b.slug, name: b.name, logoImageId: null, seller: { id: gid(`s:${b.seller}`), displayName: sellers[b.seller] }, listingCount: pool.length, categories: categoryTree(pool) });
  }
  if ((sm = /^\/api\/v1\/catalog\/sellers\/([^/]+)$/.exec(path))) {
    const key = decodeURIComponent(sm[1]);
    const handle = Object.keys(sellers).find((h) => gid(`s:${h}`) === key);
    const pool = handle ? list.filter((l) => l.seller.id === key) : [];
    if (!handle || pool.length === 0) return err(404, "not_found");
    const myBrands = brands.filter((b) => b.seller === handle && pool.some((l) => l.brand.slug === b.slug));
    return ok({ id: key, displayName: sellers[handle], listingCount: pool.length, brands: myBrands.map((b) => ({ id: gid(`b:${b.slug}`), slug: b.slug, name: b.name, logoImageId: null, seller: { id: key, displayName: sellers[handle] }, listingCount: pool.filter((l) => l.brand.slug === b.slug).length })), categories: categoryTree(pool) });
  }
  if (path === "/api/v1/catalog/categories") return ok(categoryTree(list));
  if (path === "/api/v1/catalog/brands") return ok(brands.map((b) => ({ id: gid(`b:${b.slug}`), slug: b.slug, name: b.name, seller: { id: gid(`s:${b.seller}`), displayName: sellers[b.seller] }, logoImageId: null, listingCount: list.filter((l) => l.brand.slug === b.slug).length })).filter((b) => b.listingCount > 0));
  return null;
}

/** Ids the mock answers specially for the image route: the API's 502 (bad image) and 503 (portal down). */
export const IMAGE_BAD = gid("i:mock-bad"), IMAGE_DOWN = gid("i:mock-down");

/** The size of a listing image the mock knows (null: not an image of a visible listing, the API's 404). */
export function imageInfo(id) {
  for (const l of list) for (const im of l.images) if (im.id === id) return { width: im.width, height: im.height, title: l.title };
  return null;
}
/** Test helper for the cart mock: the listing and variant behind a variant id (or null). */
export const variantInfo = (id) => { for (const l of list) for (const v of l.variants) if (v.id === id) return { listing: l, variant: v }; return null; };
