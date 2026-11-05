import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/account.reviews.$id";
import { AccountNav } from "~/components/AccountNav";
import { FormMessage } from "~/components/AuthForm";
import { RatingField, ReviewTextField } from "~/components/ReviewForm";
import { CsrfField } from "~/components/Shell";
import { Button } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";
import { MAX_PHOTOS, REVIEW_MAX, textProblem } from "~/lib/reviews";

export function meta() {
  return [{ title: "Your review | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

const MAX_FILE = 5 * 1024 * 1024;

async function mine(request: Request, context: Route.LoaderArgs["context"], id: string) {
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(id)) throw new Response("Not found", { status: 404, headers: privateHeaders });
  try {
    const found = (await api.myReviews(ctx)).find((x) => x.review.id === id);   // another buyer's review is simply not in this list: 404
    if (!found) throw new Response("Not found", { status: 404, headers: privateHeaders });
    return { ctx, ...found };
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const m = await mine(request, context, params.id);
  const u = new URL(request.url);
  return { review: m.review, listing: m.listing, created: u.searchParams.has("created"), saved: u.searchParams.has("saved"), notice: u.searchParams.get("notice") };
}

/** Save the text and rating, add a photo (one file, checked for size here and by its bytes at the API) or take one away. Every post checks csrf and origin first. */
export async function action({ params, request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const m = await mine(request, context, params.id);
  const intent = String(form.get("intent") ?? "");
  const here = `/account/reviews/${encodeURIComponent(params.id)}`;
  try {
    if (intent === "save") {
      const rating = Number(form.get("rating"));
      const text = String(form.get("text") ?? "").slice(0, REVIEW_MAX * 4);
      const errors: Record<string, string> = {};
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = "Choose 1 to 5 stars.";
      const tp = textProblem(text, REVIEW_MAX);
      if (tp) errors.text = tp;
      if (Object.keys(errors).length) return formError({ errors, values: { rating, text } }, 422);
      try { await api.editReview(m.ctx, params.id, { rating, text }); }
      catch (e) { if (e instanceof ApiError && e.status === 422 && e.fieldErrors) return formError({ errors: e.fieldErrors, values: { rating, text } }, 422); throw e; }
      return redirect(`${here}?saved=1`, { headers: privateHeaders });
    }
    if (intent === "upload") {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) return redirect(`${here}?notice=nofile`, { headers: privateHeaders });
      if (file.size > MAX_FILE) return redirect(`${here}?notice=toobig`, { headers: privateHeaders });
      const out = new FormData();
      out.set("file", file, "photo");   // the name is never used: the API decides by the bytes
      try { await api.uploadReviewPhoto(m.ctx, params.id, out); }
      catch (e) {
        if (e instanceof ApiError && e.code === "bad_photo") return redirect(`${here}?notice=badphoto`, { headers: privateHeaders });
        if (e instanceof ApiError && e.code === "too_many_photos") return redirect(`${here}?notice=toomany`, { headers: privateHeaders });
        throw e;
      }
      return redirect(`${here}?notice=added`, { headers: privateHeaders });
    }
    if (intent === "remove-photo") {
      const photoId = String(form.get("photoId") ?? "");
      if (!isSafeId(photoId)) throw new Response("Bad request", { status: 400 });
      await api.deleteReviewPhoto(m.ctx, params.id, photoId);
      return redirect(`${here}?notice=removed`, { headers: privateHeaders });
    }
  } catch (e) {
    return failAccount(e, request);
  }
  throw new Response("Bad request", { status: 400 });
}

const NOTICES: Record<string, string> = {
  added: "Photo added.", removed: "Photo removed.", nofile: "Choose a picture first.", toobig: "That picture is over 5 MB.",
  badphoto: "We couldn't use that file. Use a JPEG, PNG or WebP picture.", toomany: `A review can have up to ${MAX_PHOTOS} photos.`,
};

export default function EditReview({ loaderData, actionData }: Route.ComponentProps) {
  const { review: r, listing } = loaderData;
  const busy = useNavigation().state !== "idle";
  const errors = (actionData && "errors" in actionData ? actionData.errors : {}) as Record<string, string>;
  const values = actionData && "values" in actionData ? (actionData.values as { rating: number; text: string }) : undefined;
  const notice = loaderData.notice ? NOTICES[loaderData.notice] : undefined;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <h2>Your review{listing ? `: ${listing.title}` : ""}</h2>
      {loaderData.created && <FormMessage kind="ok">Your review is published. You can add photos below.</FormMessage>}
      {loaderData.saved && <FormMessage kind="ok">Changes saved.</FormMessage>}
      {r.status && r.status !== "published" && <FormMessage kind="error">This review is not shown{r.moderationNote ? `: ${r.moderationNote}` : "."} It can't be changed.</FormMessage>}
      {r.canEdit && (
        <>
          <Form method="post" className="stack" noValidate>
            <CsrfField /><input type="hidden" name="intent" value="save" />
            {Object.keys(errors).length > 0 && <FormMessage kind="error">Please check the highlighted fields.</FormMessage>}
            <RatingField defaultValue={values?.rating ?? r.rating} error={errors.rating} />
            <ReviewTextField defaultValue={values?.text ?? r.text} error={errors.text} />
            <Button type="submit" disabled={busy}>Save changes</Button>
          </Form>
          <section className="stack" aria-labelledby="photos-h" style={{ marginTop: "var(--s4)" }}>
            <h3 id="photos-h">Photos ({r.photos.length} of {MAX_PHOTOS})</h3>
            {notice && <p role="status" className="card">{notice}</p>}
            {r.photos.length > 0 && (
              <ul className="row" style={{ listStyle: "none", padding: 0 }}>
                {r.photos.map((p, i) => (
                  <li key={p.id} className="stack">
                    <img src={`/review-photo/${encodeURIComponent(p.id)}`} width={Math.min(p.width, 160)} height={Math.round(p.height * Math.min(1, 160 / p.width))} alt={`Your upload ${i + 1}`} style={{ maxWidth: "100%", height: "auto" }} />
                    <Form method="post"><CsrfField /><input type="hidden" name="intent" value="remove-photo" /><input type="hidden" name="photoId" value={p.id} /><Button type="submit" variant="ghost" aria-label={`Remove your photo ${i + 1}`}>Remove</Button></Form>
                  </li>
                ))}
              </ul>
            )}
            {r.photos.length < MAX_PHOTOS && (
              <Form method="post" encType="multipart/form-data" className="stack">
                <CsrfField /><input type="hidden" name="intent" value="upload" />
                <div className="field">
                  <label htmlFor="photo-file">Add a photo</label>
                  <input id="photo-file" name="file" type="file" accept="image/jpeg,image/png,image/webp" className="input" aria-describedby="photo-hint" />
                  <span id="photo-hint" className="field-hint">JPEG, PNG or WebP, up to 5 MB. We remove location and camera details from every picture.</span>
                </div>
                <Button type="submit" variant="secondary" disabled={busy}>Upload photo</Button>
              </Form>
            )}
          </section>
        </>
      )}
    </div>
  );
}
