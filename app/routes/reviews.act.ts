import { redirect } from "react-router";
import type { Route } from "./+types/reviews.act";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, privateHeaders, signInRedirect } from "~/lib/auth.server";
import { apiCtx } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";
import { REPORT_REASONS, safeReturn } from "~/lib/reviews";

/**
 * Helpful votes and reports on a review, as plain form posts (they work without JavaScript) that come back to the page they were sent from with a notice from a fixed list. csrf and origin are checked first;
 * the review id is checked as an id; the return path must be on this site. Reporting needs a reason from the list.
 */
export const REVIEW_NOTICES = ["voted", "unvoted", "reported", "own", "gone", "retry"] as const;

export function loader() {
  return redirect("/");
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const back = safeReturn(form.get("return"), "/");
  const go = (notice: (typeof REVIEW_NOTICES)[number]) => {
    const u = new URL(back, "http://x");
    u.searchParams.set("rnotice", notice);
    return redirect(`${u.pathname}${u.search}#reviews`, { headers: privateHeaders });
  };
  if (!session.token) signInRedirect(new Request(new URL(back, request.url)));
  const id = String(form.get("reviewId") ?? "");
  const intent = String(form.get("intent") ?? "");
  if (!isSafeId(id)) return go("gone");
  const ctx = apiCtx(request, context, session);
  try {
    if (intent === "helpful" || intent === "unhelpful") { await api.voteReview(ctx, id, intent === "helpful"); return go(intent === "helpful" ? "voted" : "unvoted"); }
    if (intent === "report" || intent === "report-reply") {
      const reason = String(form.get("reason") ?? "");
      if (!REPORT_REASONS.some((r) => r.value === reason)) return go("retry");
      const note = String(form.get("note") ?? "").trim().slice(0, 1000);
      await api.reportReview(ctx, id, { reason, ...(note ? { note } : {}) }, intent === "report-reply");
      return go("reported");
    }
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) signInRedirect(new Request(new URL(back, request.url)));
      if (e.code === "own_review") return go("own");
      if (e.status === 404) return go("gone");
    }
    return go("retry");
  }
  return go("retry");
}
