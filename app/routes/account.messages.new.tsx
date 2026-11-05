import { redirect } from "react-router";
import type { Route } from "./+types/account.messages.new";
import { AccountNav } from "~/components/AccountNav";
import { MessageCompose } from "~/components/MessageCompose";
import { Breadcrumb } from "~/components/ui/display";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { trySend } from "~/lib/message-send.server";
import { isSafeId } from "~/lib/passkey.server";
import { str } from "~/lib/validation";

export function meta() {
  return [{ title: "New message | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

const GUID = /^[0-9a-fA-F-]{36}$/;

/** What the new message is about: one of the buyer's seller orders (?order=&seller=) or a listing (?listing=). Anything else is a 404. */
function about(q: URLSearchParams): { orderNumber?: string; sellerOrderNumber?: string; listingId?: string; marketplaceBookingId?: string } {
  const booking = q.get("booking") ?? "";
  if (booking && isSafeId(booking)) return { marketplaceBookingId: booking };
  const order = q.get("order") ?? "", seller = q.get("seller") ?? "", listing = q.get("listing") ?? "";
  if (order && isSafeId(order) && (!seller || isSafeId(seller))) return { orderNumber: order, ...(seller ? { sellerOrderNumber: seller } : {}) };
  if (listing && GUID.test(listing)) return { listingId: listing };
  throw new Response("Not found", { status: 404, headers: privateHeaders });
}

export function loader({ request, context }: Route.LoaderArgs) {
  requireAccount(request, context);
  return { about: about(new URL(request.url).searchParams) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const target = about(new URLSearchParams({ order: str(form, "order"), seller: str(form, "seller"), listing: str(form, "listing"), booking: str(form, "booking") }));
  try {
    const r = await trySend(ctx, { ...target, text: str(form, "text"), acknowledgeWarning: form.get("acknowledgeWarning") === "on" });
    if (r.ok) return redirect(`/account/messages/${encodeURIComponent(r.threadId)}`, { headers: privateHeaders });
    return formError({ text: r.failure.text, message: r.failure.message, fieldErrors: r.failure.fieldErrors, warning: r.failure.warning }, r.failure.status);
  } catch (e) {
    return failAccount(e, request);
  }
}

export default function NewMessage({ loaderData, actionData }: Route.ComponentProps) {
  const a = loaderData.about;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <Breadcrumb items={[{ label: "Messages", to: "/account/messages" }, { label: "New message" }]} />
      <h2>{a.marketplaceBookingId ? `Message the provider about booking ${a.marketplaceBookingId}` : a.orderNumber ? `Message the seller about order ${a.orderNumber}` : "Ask the seller a question"}</h2>
      <p className="muted">The seller sees your display name only, never your email address.</p>
      <MessageCompose state={actionData} hidden={{ order: a.orderNumber ?? "", seller: a.sellerOrderNumber ?? "", listing: a.listingId ?? "", booking: a.marketplaceBookingId ?? "" }} />
    </div>
  );
}
