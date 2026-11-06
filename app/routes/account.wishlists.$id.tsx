import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/account.wishlists.$id";
import { AccountNav } from "~/components/AccountNav";
import { FormMessage } from "~/components/AuthForm";
import { Img } from "~/components/Img";
import { CsrfField } from "~/components/Shell";
import { Badge, Card, EmptyState, Price } from "~/components/ui/display";
import { Button } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { isSafeId } from "~/lib/passkey.server";
import { NAME_MAX } from "~/lib/lists";
import { listingPath } from "~/lib/urls";

export function meta() {
  return [{ title: "Wishlist | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(params.id)) throw new Response("Not found", { status: 404, headers: privateHeaders });
  try {
    return await api.wishlist(ctx, params.id);
  } catch (e) {
    return failAccount(e, request);
  }
}

/**
 * Rename, remove an item, delete the list, make or revoke the share link. The link is shown ONCE, in the answer of the "share" action (the API keeps only its hash), and never put in a
 * URL or a cookie; a new link replaces the old one.
 */
export async function action({ params, request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const id = params.id;
  if (!isSafeId(id)) throw new Response("Not found", { status: 404, headers: privateHeaders });
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "rename") {
      try { await api.renameWishlist(ctx, id, String(form.get("name") ?? "").slice(0, NAME_MAX * 4)); }
      catch (e) {
        if (e instanceof ApiError && (e.status === 409 || e.status === 422)) return formError({ error: e.status === 409 ? "You already have a list with that name." : e.fieldErrors?.name ?? "Check the name and try again." }, e.status);
        throw e;
      }
    } else if (intent === "remove") {
      const listingId = String(form.get("listingId") ?? "");
      if (!isSafeId(listingId)) throw new Response("Bad request", { status: 400 });
      await api.removeWishlistItem(ctx, id, listingId);
    } else if (intent === "delete") {
      await api.deleteWishlist(ctx, id);
      return redirect("/account/wishlists", { headers: privateHeaders });
    } else if (intent === "share") {
      const key = await api.shareWishlist(ctx, id);
      return formError({ shareUrl: `${getConfig().publicOrigin}/wishlists/shared/${key}` }, 200);
    } else if (intent === "unshare") {
      await api.unshareWishlist(ctx, id);
    } else throw new Response("Bad request", { status: 400 });
  } catch (e) {
    return failAccount(e, request);
  }
  return redirect(`/account/wishlists/${encodeURIComponent(id)}`, { headers: privateHeaders });
}

export default function WishlistPage({ loaderData, actionData }: Route.ComponentProps) {
  const { wishlist, items } = loaderData;
  const busy = useNavigation().state !== "idle";
  const error = actionData && "error" in actionData ? actionData.error : null;
  const shareUrl = actionData && "shareUrl" in actionData ? actionData.shareUrl : null;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <p><Link to="/account/wishlists">All lists</Link></p>
      <h2>{wishlist.name}</h2>
      {error && <FormMessage kind="error">{error}</FormMessage>}
      {items.length === 0 ? (
        <EmptyState title="This list is empty">Use "Save to a list" on a product page to add it here.</EmptyState>
      ) : (
        <ul className="grid u-list-style-none-padding-0" aria-label={`Items in ${wishlist.name}`}>
          {items.map((i) => (
            <li key={i.listingId}>
              <Card className="stack">
                {i.listing ? (
                  <>
                    {i.listing.image && <Img imageId={i.listing.image.id} width={i.listing.image.width} height={i.listing.image.height} alt={i.listing.image.alt} sizes="(min-width: 700px) 25vw, 50vw" />}
                    <p className="u-margin-0"><Link to={listingPath(i.listing.slug)}><strong>{i.listing.title}</strong></Link></p>
                    <p className="u-margin-0"><Price cents={i.listing.priceFromCents} currency={i.listing.currency} /></p>
                    {!i.listing.available && <Badge tone="neutral">Sold out</Badge>}
                  </>
                ) : (
                  <><strong>No longer available</strong><span className="muted">This item is not on Solvelt right now. It stays on your list in case it comes back.</span></>
                )}
                <Form method="post">
                  <CsrfField /><input type="hidden" name="intent" value="remove" /><input type="hidden" name="listingId" value={i.listingId} />
                  <Button type="submit" variant="ghost" disabled={busy} aria-label={`Remove ${i.listing?.title ?? "this item"} from ${wishlist.name}`}>Remove</Button>
                </Form>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <section className="stack u-margin-top-var-s4" aria-labelledby="share-h">
        <h3 id="share-h">Share</h3>
        <p className="muted">{wishlist.shared ? "Anyone with the link can see this list (names and prices of the items, nothing about you)." : "This list is private."}</p>
        {shareUrl && (
          <div role="status" className="stack">
            <p>Your link (shown once; copy it now):</p>
            <input className="input" readOnly value={shareUrl} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}
        <div className="row">
          <Form method="post"><CsrfField /><input type="hidden" name="intent" value="share" /><Button type="submit" variant="secondary" disabled={busy}>{wishlist.shared ? "Make a new link (stops the old one)" : "Create a share link"}</Button></Form>
          {wishlist.shared && <Form method="post"><CsrfField /><input type="hidden" name="intent" value="unshare" /><Button type="submit" variant="secondary" disabled={busy}>Stop sharing</Button></Form>}
        </div>
      </section>

      <section className="stack u-margin-top-var-s4" aria-labelledby="manage-h">
        <h3 id="manage-h">Manage this list</h3>
        <Form method="post" className="row u-align-items-flex-end" noValidate>
          <CsrfField /><input type="hidden" name="intent" value="rename" />
          <label className="field"><span>Name</span><input className="input" name="name" defaultValue={wishlist.name} maxLength={NAME_MAX} required autoComplete="off" /></label>
          <Button type="submit" variant="secondary" disabled={busy}>Rename</Button>
        </Form>
        <Form method="post"><CsrfField /><input type="hidden" name="intent" value="delete" /><Button type="submit" variant="ghost" disabled={busy} aria-label={`Delete this list, ${wishlist.name}`}>Delete this list</Button></Form>
      </section>
    </div>
  );
}
