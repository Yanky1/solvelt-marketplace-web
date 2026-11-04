import { Form, Link, data as routerData, redirect } from "react-router";
import type { Route } from "./+types/cart";
import { CsrfField } from "~/components/Shell";
import { Badge, Card, EmptyState, formatMoney } from "~/components/ui/display";
import { Button, LinkButton } from "~/components/ui/form";
import { ApiError, api, type Cart } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, privateHeaders } from "~/lib/auth.server";
import { cookieFor, readCart } from "~/lib/cart.server";
import { isSafeId } from "~/lib/passkey.server";
import type { SessionData } from "~/lib/session.server";

export function meta() {
  return [{ title: "Your cart | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

const NOTICES: Record<string, { tone: "ok" | "warn"; text: string }> = {
  added: { tone: "ok", text: "Added to your cart." },
  unavailable: { tone: "warn", text: "That item is not available right now, so it was not added." },
  full: { tone: "warn", text: "Your cart is full. Remove something before adding more." },
  quantity: { tone: "warn", text: "You can buy up to 20 of one item at a time." },
  busy: { tone: "warn", text: "The cart is busy. Please try again in a moment." },
  retry: { tone: "warn", text: "We could not update your cart. Please try again." },
  updated: { tone: "ok", text: "Your cart was updated." },
  removed: { tone: "ok", text: "Removed from your cart." },
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const { cart, setCookie } = await readCart(request, context);
  const notice = new URL(request.url).searchParams.get("notice");
  // Only what the page shows: no guest token ever reaches loader data (decision M3W-01).
  return data({ cart, notice: notice && Object.hasOwn(NOTICES, notice) ? notice : null }, setCookie);
}

function data<T>(value: T, setCookie?: string) {
  return routerData(value, { headers: { ...(setCookie ? { "Set-Cookie": setCookie } : {}), ...privateHeaders } });
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const intent = String(form.get("intent") ?? "");
  const lineId = String(form.get("lineId") ?? "");
  if (!isSafeId(lineId)) throw new Response("Bad request", { status: 400 });
  const ctx = apiCtx(request, context, session);
  try {
    if (intent === "remove") {
      const cart = await api.cartRemove(ctx, session.cart, lineId);
      return redirectWith("/cart?notice=removed", session, cart);
    }
    if (intent === "set") {
      const qty = Number(form.get("qty"));
      if (!Number.isInteger(qty) || qty < 0 || qty > 20) return redirectWith("/cart?notice=quantity");
      const cart = qty === 0 ? await api.cartRemove(ctx, session.cart, lineId) : await api.cartSetQuantity(ctx, session.cart, lineId, qty);
      return redirectWith(qty === 0 ? "/cart?notice=removed" : "/cart?notice=updated", session, cart);
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return redirectWith("/cart");   // the line is gone (merged or removed elsewhere): show the cart as it is
    return redirectWith("/cart?notice=retry");
  }
  throw new Response("Bad request", { status: 400 });
}

function redirectWith(to: string, session?: SessionData | null, cart?: Cart) {
  const { setCookie } = (cart ? cookieFor(session ?? null, cart) : {}) as { setCookie?: string };
  return redirect(to, { headers: { ...(setCookie ? { "Set-Cookie": setCookie } : {}), ...privateHeaders } });
}

export default function CartPage({ loaderData }: Route.ComponentProps) {
  const { cart, notice } = loaderData;
  const n = notice ? NOTICES[notice] : null;
  return (
    <div className="stack">
      <h1>Your cart</h1>
      {n && <p role={n.tone === "warn" ? "alert" : "status"} className={n.tone === "warn" ? "notice notice-warn" : "notice"} data-testid="cart-notice">{n.text}</p>}
      {cart.groups.length === 0 ? (
        <EmptyState title="Your cart is empty" action={<LinkButton to="/">Keep shopping</LinkButton>}>Items you add wait here, also after you sign in.</EmptyState>
      ) : (
        <>
          {cart.groups.map((g) => (
            <Card key={`${g.sellerId}:${g.brandId}`} className="stack" data-testid="cart-group">
              <h2 style={{ margin: 0 }}>{g.brandName || g.sellerName}</h2>
              <p className="muted" style={{ margin: 0 }}>Sold by {g.sellerName}. Shipped by this seller.</p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }} className="stack">
                {g.lines.map((l) => (
                  <li key={l.id} className="stack" data-testid="cart-line">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <Link to={`/p/${encodeURIComponent(l.slug)}`}><strong>{l.title}</strong></Link>
                        <div className="muted">{l.variantName}</div>
                        {l.status === "unavailable" && <Badge tone="err">No longer available</Badge>}
                        {l.status === "ok" && l.previousUnitPriceCents !== null && l.previousUnitPriceCents !== l.unitPriceCents && (
                          <p role="status" className="muted" style={{ margin: 0 }}>The price changed from {formatMoney(l.previousUnitPriceCents, cart.currency)} to {formatMoney(l.unitPriceCents, cart.currency)}.</p>
                        )}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        {l.status === "ok" ? <><div>{formatMoney(l.lineTotalCents, cart.currency)}</div><div className="muted">{formatMoney(l.unitPriceCents, cart.currency)} each</div></> : <div className="muted">Not counted</div>}
                      </div>
                    </div>
                    <div className="row">
                      <Form method="post" className="row">
                        <CsrfField />
                        <input type="hidden" name="intent" value="set" />
                        <input type="hidden" name="lineId" value={l.id} />
                        <label>Quantity <input name="qty" type="number" min={0} max={20} defaultValue={l.quantity} className="input" style={{ width: "5rem" }} aria-label={`Quantity of ${l.title}, ${l.variantName}`} /></label>
                        <Button type="submit" variant="secondary">Update</Button>
                      </Form>
                      <Form method="post">
                        <CsrfField />
                        <input type="hidden" name="intent" value="remove" />
                        <input type="hidden" name="lineId" value={l.id} />
                        <Button type="submit" variant="ghost" aria-label={`Remove ${l.title}, ${l.variantName}, from your cart`}>Remove</Button>
                      </Form>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="row" style={{ justifyContent: "space-between" }}><span>Subtotal</span><strong>{formatMoney(g.subtotalCents, cart.currency)}</strong></div>
            </Card>
          ))}
          <Card className="stack">
            <div className="row" style={{ justifyContent: "space-between" }}><span>Items ({cart.itemCount})</span><strong data-testid="cart-subtotal">{formatMoney(cart.subtotalCents, cart.currency)}</strong></div>
            <p className="muted" style={{ margin: 0 }}>Shipping and tax are added at checkout, once we know where it is going.</p>
            {cart.canCheckout
              ? <LinkButton to="/checkout">Checkout</LinkButton>
              : <p role="status" className="muted">Remove the items that are no longer available to continue.</p>}
          </Card>
        </>
      )}
    </div>
  );
}
