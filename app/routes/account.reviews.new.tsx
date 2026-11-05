import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/account.reviews.new";
import { AccountNav } from "~/components/AccountNav";
import { FormMessage } from "~/components/AuthForm";
import { RatingField, ReviewTextField } from "~/components/ReviewForm";
import { CsrfField } from "~/components/Shell";
import { Button } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";
import { REVIEW_MAX, textProblem } from "~/lib/reviews";

export function meta() {
  return [{ title: "Write a review | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

/** The thing being reviewed must be one the API lists as reviewable for the listing; its label is shown so the buyer knows what they are rating. */
async function target(request: Request, context: Route.LoaderArgs["context"]) {
  const { ctx } = requireAccount(request, context);
  const u = new URL(request.url);
  const kind = u.searchParams.get("kind") ?? "", id = u.searchParams.get("target") ?? "", listing = u.searchParams.get("listing") ?? "";
  if (!isSafeId(id) || !isSafeId(listing) || (kind !== "order_line" && kind !== "booking")) throw new Response("Not found", { status: 404, headers: privateHeaders });
  try {
    const item = (await api.reviewable(ctx, listing)).find((i) => i.id === id && i.kind === kind);
    if (!item) throw new Response("Not found", { status: 404, headers: privateHeaders });
    return { ctx, kind, id, listing, label: item.label };
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const t = await target(request, context);
  return { kind: t.kind, id: t.id, listing: t.listing, label: t.label };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const t = await target(request, context);
  const rating = Number(form.get("rating"));
  const text = String(form.get("text") ?? "").slice(0, REVIEW_MAX * 4);
  const errors: Record<string, string> = {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = "Choose 1 to 5 stars.";
  const tp = textProblem(text, REVIEW_MAX);
  if (tp) errors.text = tp;
  if (Object.keys(errors).length) return formError({ errors, values: { rating, text } }, 422);
  try {
    const created = await api.createReview(t.ctx, { kind: t.kind, targetId: t.id, rating, text });
    return redirect(created ? `/account/reviews/${encodeURIComponent(created.id)}?created=1` : "/account/reviews", { headers: privateHeaders });
  } catch (e) {
    if (e instanceof ApiError && e.status === 422 && e.fieldErrors) return formError({ errors: e.fieldErrors, values: { rating, text } }, 422);
    if (e instanceof ApiError && (e.status === 409 || e.code === "not_eligible")) return redirect("/account/reviews", { headers: privateHeaders });
    return failAccount(e, request);
  }
}

export default function NewReview({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const errors = (actionData && "errors" in actionData ? actionData.errors : {}) as Record<string, string>;
  const values = actionData && "values" in actionData ? (actionData.values as { rating: number; text: string }) : undefined;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <h2>Write a review</h2>
      <p>{loaderData.label}</p>
      <Form method="post" className="stack" noValidate>
        <CsrfField />
        {Object.keys(errors).length > 0 && <FormMessage kind="error">Please check the highlighted fields.</FormMessage>}
        <RatingField defaultValue={values?.rating} error={errors.rating} />
        <ReviewTextField defaultValue={values?.text} error={errors.text} />
        <p className="muted">Your review shows your first name and the first letter of your last name. You can add photos on the next page.</p>
        <Button type="submit" disabled={busy}>Publish review</Button>
      </Form>
    </div>
  );
}
