import { useEffect, useState } from "react";
import { Form, Link, useLocation, useSearchParams } from "react-router";
import { CsrfField, useRootData } from "./Shell";
import { RatingStars } from "./ui/display";
import { Button } from "./ui/form";
import { REPORT_REASONS, SORTS, SORT_LABELS, type ReviewPage, type ReviewView, type Reviewable, type ReviewSort } from "~/lib/reviews";

const NOTICES: Record<string, string> = {
  voted: "Thanks, marked as helpful.", unvoted: "Your vote was taken back.", reported: "Thank you. We sent your report to our moderators.",
  own: "You can't do that to your own review.", gone: "That review is not available any more.", retry: "Something went wrong. Please try again.",
};
/** Links in lists and rows are at least 2rem tall and wide (WCAG 2.2 target size). */
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

function ReviewCard({ r, back, signedIn }: { r: ReviewView; back: string; signedIn: boolean }) {
  return (
    <article className="review stack" aria-label={`Review by ${r.displayName}, ${r.rating} out of 5`} data-testid="review">
      <div className="row u-justify-content-space-between">
        <RatingStars value={r.rating} />
        <span className="muted">{r.displayName} · {dateOf(r.createdAt)}{r.editedAt ? " (edited)" : ""} · Verified purchase</span>
      </div>
      <p className="u-white-space-pre-line-margin-0">{r.text}</p>
      {r.photos.length > 0 && (
        <ul className="row u-list-style-none-padding-0" aria-label="Photos from this review">
          {r.photos.map((p) => (
            <li key={p.id}><img src={`/review-photo/${encodeURIComponent(p.id)}`} width={Math.min(p.width, 160)} height={Math.round(p.height * Math.min(1, 160 / p.width))} loading="lazy" alt={`From the review by ${r.displayName}`} className="u-max-width-100-height-auto-border-radius-var-r1-6px" /></li>
          ))}
        </ul>
      )}
      {r.reply && (
        <div className="card stack u-margin-left-var-s3">
          <strong>Reply from the seller</strong>
          <p className="u-white-space-pre-line-margin-0">{r.reply.text}</p>
          {signedIn && (
            <details><summary>Report this reply</summary>
              <ReportForm reviewId={r.id} back={back} intent="report-reply" /></details>
          )}
        </div>
      )}
      <div className="row">
        <Form method="post" action="/reviews/act" preventScrollReset>
          <CsrfField /><input type="hidden" name="reviewId" value={r.id} /><input type="hidden" name="return" value={back} /><input type="hidden" name="intent" value="helpful" />
          <Button type="submit" variant="secondary" aria-label={`Mark the review by ${r.displayName} as helpful`}>Helpful{r.helpfulCount > 0 ? ` (${r.helpfulCount})` : ""}</Button>
        </Form>
        <details><summary className="btn btn-ghost">Report</summary><ReportForm reviewId={r.id} back={back} intent="report" /></details>
      </div>
    </article>
  );
}

function ReportForm({ reviewId, back, intent }: { reviewId: string; back: string; intent: string }) {
  const id = `report-${reviewId}-${intent}`;
  return (
    <Form method="post" action="/reviews/act" className="stack" preventScrollReset>
      <CsrfField /><input type="hidden" name="reviewId" value={reviewId} /><input type="hidden" name="return" value={back} /><input type="hidden" name="intent" value={intent} />
      <div className="field">
        <label htmlFor={`${id}-reason`}>Why are you reporting this?</label>
        <select id={`${id}-reason`} name="reason" className="select" required defaultValue="">
          <option value="" disabled>Choose a reason</option>
          {REPORT_REASONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-note`}>More detail (optional)</label>
        <textarea id={`${id}-note`} name="note" className="input" rows={2} maxLength={1000} />
      </div>
      <Button type="submit" variant="secondary">Send report</Button>
    </Form>
  );
}

/** The write-a-review prompt: asks `/reviews/eligible` from the browser (the page is public and has no session) and offers one link per line or booking the buyer can still review. */
function WritePrompt({ listingId }: { listingId: string }) {
  const root = useRootData();
  const location = useLocation();
  const [items, setItems] = useState<Reviewable[] | null>(null);
  const signedIn = !!root?.user;
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetch(`/reviews/eligible?listingId=${encodeURIComponent(listingId)}`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((b: { items?: Reviewable[] }) => { if (live) setItems(b.items ?? []); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [signedIn, listingId]);
  if (!signedIn) return <p><Link to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in</Link> to review something you bought or booked.</p>;
  if (items === null) return null;
  if (items.length === 0) return <p className="muted">You can review this once you have received it or attended it.</p>;
  return (
    <ul className="stack u-list-style-none-padding-0" aria-label="What you can review">
      {items.map((i) => <li key={i.id}><Link className="btn btn-secondary" to={`/account/reviews/new?kind=${i.kind}&target=${encodeURIComponent(i.id)}&listing=${encodeURIComponent(listingId)}`}>Write a review: {i.label}</Link></li>)}
    </ul>
  );
}

export function ReviewsSection({ listingId, data, query }: { listingId: string; data: ReviewPage; query: { sort: ReviewSort; rating: number | null; page: number } }) {
  const root = useRootData();
  const location = useLocation();
  const [params] = useSearchParams();
  const signedIn = !!root?.user;
  const notice = NOTICES[params.get("rnotice") ?? ""];
  const { summary } = data;
  const total = Math.max(1, ...summary.distribution);
  const back = (() => { const u = new URLSearchParams(location.search); u.delete("rnotice"); u.delete("qnotice"); const q = u.toString(); return location.pathname + (q ? `?${q}` : ""); })();
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const href = (page: number) => { const u = new URLSearchParams(location.search); u.delete("rnotice"); u.delete("qnotice"); if (page > 1) u.set("rpage", String(page)); else u.delete("rpage"); return `${location.pathname}?${u.toString()}#reviews`; };
  return (
    <section id="reviews" aria-labelledby="reviews-h" className="pdp-section stack">
      <h2 id="reviews-h">Reviews</h2>
      {notice && <p role="status" className="card">{notice}</p>}
      {summary.count === 0 ? (
        <p className="muted">No reviews yet.</p>
      ) : (
        <div className="stack" data-testid="rating-summary">
          <p className="u-margin-0 u-font-size-var-fs-h3-1-5rem"><strong>{summary.average?.toFixed(1)}</strong> out of 5 · {summary.count} {summary.count === 1 ? "review" : "reviews"}</p>
          <ul className="u-list-style-none-padding-0" aria-label="Reviews by rating">
            {[5, 4, 3, 2, 1].map((n) => (
              <li key={n}>
                <Link to={`${location.pathname}?${new URLSearchParams({ ...(query.sort !== "recent" ? { rsort: query.sort } : {}), rrating: String(n) }).toString()}#reviews`}
                  className="u-display-flex-align-items-center-gap-var-s2-0-75rem-min-height-2-5rem" aria-label={`${n} stars: ${summary.distribution[n - 1]} reviews. Show only these.`}>
                  <span className="u-min-width-4-5rem">{n} {n === 1 ? "star" : "stars"}</span>
                  <progress max={total} value={summary.distribution[n - 1]} aria-hidden="true" className="u-flex-1-1-8rem" />
                  <span className="u-min-width-2rem-text-align-right">{summary.distribution[n - 1]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <WritePrompt listingId={listingId} />
      {summary.count > 0 && (
        <Form method="get" action={`${location.pathname}#reviews`} className="row u-align-items-flex-end">
          {params.get("variant") && <input type="hidden" name="variant" value={params.get("variant")!} />}
          <div className="field">
            <label htmlFor="rsort">Sort by</label>
            <select id="rsort" name="rsort" className="select" defaultValue={query.sort}>{SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}</select>
          </div>
          <div className="field">
            <label htmlFor="rrating">Show</label>
            <select id="rrating" name="rrating" className="select" defaultValue={query.rating ?? ""}><option value="">All ratings</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} {n === 1 ? "star" : "stars"}</option>)}</select>
          </div>
          <Button type="submit" variant="secondary">Apply</Button>
        </Form>
      )}
      {data.reviews.map((r) => <ReviewCard key={r.id} r={r} back={back} signedIn={signedIn} />)}
      {data.reviews.length === 0 && summary.count > 0 && <p className="muted">No reviews match this filter. <Link to={`${location.pathname}#reviews`} className="u-tap">Show all</Link></p>}
      {pages > 1 && (
        <nav aria-label="Review pages" className="row">
          {query.page > 1 && <Link to={href(query.page - 1)} rel="prev" className="u-tap">Previous</Link>}
          <span>Page {query.page} of {pages}</span>
          {query.page < pages && <Link to={href(query.page + 1)} rel="next" className="u-tap">Next</Link>}
        </nav>
      )}
    </section>
  );
}
