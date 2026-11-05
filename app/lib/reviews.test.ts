import { describe, expect, it } from "vitest";
import { parseQuestions, parseReview, parseReviewPage, parseReviewable, parseSummary, reviewJsonLd, reviewQuery, safeReturn, textProblem } from "./reviews";

const review = (over: Record<string, unknown> = {}) => ({ id: "r1", listingId: "l1", rating: 4, text: "Lovely", displayName: "Dana L.", createdAt: "2026-11-05T10:00:00Z", editedAt: null, helpfulCount: 2, photos: [], reply: null, ...over });

describe("parsers", () => {
  it("accept what the API sends and drop what is malformed", () => {
    expect(parseReview(review())?.rating).toBe(4);
    expect(parseReview(review({ rating: 6 }))).toBeNull();
    expect(parseReview(review({ rating: 0 }))).toBeNull();
    expect(parseReview(review({ text: 5 }))).toBeNull();
    expect(parseReview(null)).toBeNull();
    expect(parseReview(review({ reply: { id: "RP-1", text: "Thank you", at: "2026-11-06T10:00:00Z" } }))?.reply?.text).toBe("Thank you");
    expect(parseReview(review({ reply: { id: "RP-1" } }))?.reply).toBeNull();
    const withPhotos = parseReview(review({ photos: [{ id: "p1", width: 10, height: 20 }, { id: "p2" }, ...Array.from({ length: 9 }, (_, i) => ({ id: `q${i}`, width: 1, height: 1 }))] }));
    expect(withPhotos?.photos).toHaveLength(5);   // never more than five, never one without a size
    expect(parseSummary({ count: 3, average: 4.3, distribution: [0, 0, 1, 1, 1] })).toEqual({ count: 3, average: 4.3, distribution: [0, 0, 1, 1, 1] });
    expect(parseSummary({ count: 0, average: 4.3 })).toEqual({ count: 0, average: null, distribution: [0, 0, 0, 0, 0] });
    expect(parseSummary({ count: 2, average: 9 }).average).toBeNull();
    expect(parseReviewPage({ summary: { count: 1, average: 4, distribution: [0, 0, 0, 1, 0] }, reviews: [review(), { nope: 1 }], page: 2, pageSize: 10, total: 11 }).reviews).toHaveLength(1);
    expect(parseReviewable([{ kind: "order_line", id: "a", label: "X", at: "t" }, { kind: "other", id: "b", label: "Y", at: "t" }, { kind: "booking" }])).toHaveLength(1);
    expect(parseQuestions([{ id: "Q-1", text: "Hi?", status: "sent", createdAt: "t", listing: { title: "T", slug: "s" } }, { id: "Q-2" }])).toHaveLength(1);
  });
});

describe("the review list's address", () => {
  it("falls back to the default for anything that is not a known choice, so one view has one address", () => {
    expect(reviewQuery(new URLSearchParams(""))).toEqual({ sort: "recent", rating: null, page: 1 });
    expect(reviewQuery(new URLSearchParams("rsort=helpful&rrating=3&rpage=2"))).toEqual({ sort: "helpful", rating: 3, page: 2 });
    expect(reviewQuery(new URLSearchParams("rsort=drop%20table&rrating=9&rpage=-1"))).toEqual({ sort: "recent", rating: null, page: 1 });
    expect(reviewQuery(new URLSearchParams("rrating=2.5&rpage=1e3"))).toEqual({ sort: "recent", rating: null, page: 1 });
  });
});

describe("structured data", () => {
  it("is only emitted for a listing that has a published review, with the figures and the reviews as shown", () => {
    const empty = parseReviewPage({ summary: { count: 0 }, reviews: [] });
    expect(reviewJsonLd(empty)).toBeNull();
    const page = parseReviewPage({ summary: { count: 2, average: 4.5, distribution: [0, 0, 0, 1, 1] }, reviews: [review({ rating: 5, text: "Great" }), review({ id: "r2" })] });
    const ld = reviewJsonLd(page)!;
    expect(ld.aggregateRating).toMatchObject({ "@type": "AggregateRating", ratingValue: 4.5, reviewCount: 2, bestRating: 5 });
    expect(ld.review).toHaveLength(2);
    expect(ld.review[0]).toMatchObject({ "@type": "Review", author: { name: "Dana L." }, datePublished: "2026-11-05", reviewRating: { ratingValue: 5 } });
    expect(JSON.stringify(ld)).not.toMatch(/@example|accountId/);
  });
});

describe("small helpers", () => {
  it("only send a buyer back to a path on this site", () => {
    expect(safeReturn("/p/some-item?variant=1")).toBe("/p/some-item?variant=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "javascript:alert(1)", "/a b", "/a\nb", undefined, 5]) expect(safeReturn(bad)).toBe("/");
  });
  it("check the length of a text in characters", () => {
    expect(textProblem("  ", 10)).not.toBeNull();
    expect(textProblem("ok", 10)).toBeNull();
    expect(textProblem("x".repeat(11), 10)).not.toBeNull();
    expect(textProblem("😀".repeat(10), 10)).toBeNull();   // an emoji is one character, not two
  });
});
