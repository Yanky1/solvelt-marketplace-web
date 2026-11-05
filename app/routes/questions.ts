import { redirect } from "react-router";
import type { Route } from "./+types/questions";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, privateHeaders, signInRedirect } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";
import { QUESTION_MAX, safeReturn } from "~/lib/reviews";

/** Asking a seller a question from a product page (a plain form post): csrf and origin first, the text is cut at the limit, the answer is a notice from a fixed list on the page the buyer came from. */
export const QUESTION_NOTICES = ["asked", "invalid", "limit", "gone", "retry"] as const;

export function loader() {
  return redirect("/");
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const back = safeReturn(form.get("return"), "/");
  const go = (notice: (typeof QUESTION_NOTICES)[number]) => {
    const u = new URL(back, "http://x");
    u.searchParams.set("qnotice", notice);
    return redirect(`${u.pathname}${u.search}#questions`, { headers: privateHeaders });
  };
  if (!session.token) signInRedirect(new Request(new URL(back, request.url)));
  const listingId = String(form.get("listingId") ?? "");
  if (!isSafeId(listingId)) return go("gone");
  try {
    await api.askQuestion(apiCtx(request, context, session), { listingId, text: String(form.get("text") ?? "").slice(0, QUESTION_MAX * 4) });
    return go("asked");
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) signInRedirect(new Request(new URL(back, request.url)));
      if (e.status === 404) return go("gone");
      if (e.status === 422) return go("invalid");
      if (e.status === 429) return go("limit");
    }
    return go("retry");
  }
}
