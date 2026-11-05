/**
 * Reviews, ratings and product questions (M6; API repo docs/API.md "Reviews and ratings" and "Product questions"): types, defensive parsers for what the API answers, the structured data of a product page
 * and the small helpers the forms share. Nothing here talks to the network.
 */
export const REVIEW_MAX = 2000;
export const QUESTION_MAX = 1000;
export const MAX_PHOTOS = 5;
export const SORTS = ["recent", "helpful", "high", "low"] as const;
export type ReviewSort = (typeof SORTS)[number];
export const SORT_LABELS: Record<ReviewSort, string> = { recent: "Newest", helpful: "Most helpful", high: "Highest rated", low: "Lowest rated" };
export const REPORT_REASONS: { value: string; label: string }[] = [
  { value: "spam", label: "Spam or advertising" }, { value: "personal_information", label: "Shares personal information" }, { value: "offensive", label: "Offensive or abusive" },
  { value: "fake", label: "Looks fake" }, { value: "off_topic", label: "Not about this product" }, { value: "other", label: "Something else" },
];

export interface ReviewPhoto { id: string; width: number; height: number }
export interface ReviewView {
  id: string; listingId: string; rating: number; text: string; displayName: string; createdAt: string; editedAt: string | null; helpfulCount: number;
  photos: ReviewPhoto[]; reply: { id: string; text: string; at: string | null } | null;
  /** Only on the buyer's own reviews. */
  status: string | null; moderationNote: string | null; canEdit: boolean;
}
export interface RatingSummary { count: number; average: number | null; distribution: number[] }
export interface ReviewPage { summary: RatingSummary; reviews: ReviewView[]; page: number; pageSize: number; total: number }
export interface Reviewable { kind: "order_line" | "booking"; id: string; label: string; at: string }
export interface QuestionView { id: string; text: string; status: string; rejectedReason: string | null; createdAt: string; listing: { title: string; slug: string } | null }

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown, max = 5000): string | null => (typeof v === "string" && v.length <= max ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

export function parseReview(v: unknown): ReviewView | null {
  const o = obj(v);
  const id = str(o?.id, 64), listingId = str(o?.listingId, 64), text = str(o?.text), name = str(o?.displayName, 240), created = str(o?.createdAt, 40), rating = int(o?.rating);
  if (!o || !id || !listingId || text === null || name === null || !created || rating === null || rating < 1 || rating > 5) return null;
  const reply = obj(o.reply);
  const rid = reply ? str(reply.id, 100) : null, rtext = reply ? str(reply.text, 8000) : null;
  const photos = (Array.isArray(o.photos) ? o.photos : []).flatMap((p) => { const x = obj(p); const pid = str(x?.id, 64), w = int(x?.width), h = int(x?.height); return pid && w && h ? [{ id: pid, width: w, height: h }] : []; }).slice(0, MAX_PHOTOS);
  return {
    id, listingId, rating, text, displayName: name, createdAt: created, editedAt: str(o.editedAt, 40), helpfulCount: int(o.helpfulCount) ?? 0, photos,
    reply: rid && rtext ? { id: rid, text: rtext, at: str(reply?.at, 40) } : null,
    status: str(o.status, 12), moderationNote: str(o.moderationNote, 400), canEdit: o.canEdit === true,
  };
}

export function parseSummary(v: unknown): RatingSummary {
  const o = obj(v);
  const count = int(o?.count) ?? 0;
  const avg = typeof o?.average === "number" && o.average >= 1 && o.average <= 5 ? o.average : null;
  const d = Array.isArray(o?.distribution) ? o.distribution.map((n) => int(n) ?? 0).slice(0, 5) : [];
  while (d.length < 5) d.push(0);
  return { count, average: count > 0 ? avg : null, distribution: d };
}

export function parseReviewPage(v: unknown): ReviewPage {
  const o = obj(v);
  return {
    summary: parseSummary(o?.summary),
    reviews: (Array.isArray(o?.reviews) ? o.reviews : []).map(parseReview).filter((r): r is ReviewView => r !== null),
    page: int(o?.page) ?? 1, pageSize: int(o?.pageSize) ?? 10, total: int(o?.total) ?? 0,
  };
}

export function parseReviewable(v: unknown): Reviewable[] {
  return (Array.isArray(v) ? v : []).flatMap((x) => {
    const o = obj(x);
    const kind = o?.kind, id = str(o?.id, 64), label = str(o?.label, 400), at = str(o?.at, 40);
    return (kind === "order_line" || kind === "booking") && id && label !== null && at ? [{ kind, id, label, at } as Reviewable] : [];
  });
}

export function parseQuestions(v: unknown): QuestionView[] {
  return (Array.isArray(v) ? v : []).flatMap((x) => {
    const o = obj(x);
    const id = str(o?.id, 100), text = str(o?.text), status = str(o?.status, 12), created = str(o?.createdAt, 40);
    if (!o || !id || text === null || !status || !created) return [];
    const l = obj(o.listing);
    return [{ id, text, status, rejectedReason: str(o.rejectedReason, 40), createdAt: created, listing: l && str(l.title, 400) !== null && str(l.slug, 160) ? { title: str(l.title, 400)!, slug: str(l.slug, 160)! } : null }];
  });
}

/** Query-string parameters of the review list on a product page (anything else falls back to the default, so one view has one address). */
export function reviewQuery(search: URLSearchParams): { sort: ReviewSort; rating: number | null; page: number } {
  const s = search.get("rsort");
  const r = search.get("rrating") ?? "", p = search.get("rpage") ?? "";
  // plain digits only ("1e3", "02" or "2.5" are not spellings of a page), so one view has one address
  return { sort: (SORTS as readonly string[]).includes(s ?? "") ? (s as ReviewSort) : "recent", rating: /^[1-5]$/.test(r) ? Number(r) : null, page: /^[1-9]\d{0,2}$/.test(p) ? Number(p) : 1 };
}

/** schema.org data for the product page: the aggregate and the reviews shown (the author is first name and initial only, as shown on the page). Nothing is emitted without a published review. */
export function reviewJsonLd(page: ReviewPage): { aggregateRating: object; review: object[] } | null {
  if (page.summary.count === 0 || page.summary.average === null) return null;
  return {
    aggregateRating: { "@type": "AggregateRating", ratingValue: page.summary.average, reviewCount: page.summary.count, bestRating: 5, worstRating: 1 },
    review: page.reviews.slice(0, 10).map((r) => ({
      "@type": "Review", author: { "@type": "Person", name: r.displayName }, datePublished: r.createdAt.slice(0, 10), reviewBody: r.text,
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
    })),
  };
}

/** Only a same-site path may be where a form sends the buyer back to. */
export function safeReturn(v: unknown, fallback = "/"): string {
  return typeof v === "string" && /^\/(?![/\\])[^\s\p{Cc}]{0,500}$/u.test(v) ? v : fallback;
}

export function textProblem(text: string, max: number): string | null {
  const t = text.trim();
  if (t.length === 0) return "Write a few words.";
  if ([...t].length > max) return `Use at most ${max} characters.`;
  return null;
}
