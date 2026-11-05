import { redirect, useActionData, useNavigation } from "react-router";
import { Form, Link } from "react-router";
import type { Route } from "./+types/checkout";
import { ErrorSummary } from "~/components/AuthForm";
import { PaymentStep } from "~/components/PaymentStep";
import { CsrfField } from "~/components/Shell";
import { Card, formatMoney } from "~/components/ui/display";
import { Button, Input, Select } from "~/components/ui/form";
import { safeFieldErrors } from "~/lib/api-errors";
import { ApiError, api, type Address, type Placed, type Quote } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, currentUser, formError, privateHeaders } from "~/lib/auth.server";
import { carrierValue, deliveryField, estimateText, groupsOf, guestExpiry, publishableKeyOk, withGrant, localValue, readCheckoutValues, readSelections, selectedValue, validateCheckout, type CheckoutValues } from "~/lib/checkout";
import { readCart } from "~/lib/cart.server";
import { getConfig } from "~/lib/config.server";
import { isSafeId } from "~/lib/passkey.server";
import { readSession, sessionCookie } from "~/lib/session.server";
import { COUNTRIES, type FieldErrors } from "~/lib/validation";

export function meta() {
  return [{ title: "Checkout | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

const EMPTY: CheckoutValues = { fullName: "", line1: "", line2: "", city: "", region: "", postalCode: "", country: "US", phone: "", isDefault: false, email: "", giftMessage: "" };
const toValues = (a: Address): CheckoutValues => ({ ...EMPTY, fullName: a.fullName, line1: a.line1, line2: a.line2 ?? "", city: a.city, region: a.region ?? "", postalCode: a.postalCode, country: a.country, phone: a.phone ?? "" });

export async function loader({ request, context }: Route.LoaderArgs) {
  const { cart, setCookie } = await readCart(request, context);
  if (cart.groups.length === 0 || !cart.canCheckout) throw redirect("/cart", { headers: { ...(setCookie ? { "Set-Cookie": setCookie } : {}), ...privateHeaders } });
  const { user } = await currentUser(request, context);
  const session = readSession(request, getConfig());
  let addresses: Address[] = [];
  let values: CheckoutValues = EMPTY;
  if (user && session?.token) {
    try {
      addresses = await api.addresses(apiCtx(request, context, session));
      const pick = new URL(request.url).searchParams.get("address");
      const chosen = (pick && isSafeId(pick) ? addresses.find((a) => a.id === pick) : undefined) ?? addresses.find((a) => a.isDefault);
      if (chosen) values = toValues(chosen);
    } catch { /* checkout works without saved addresses */ }
  }
  return { cart, signedIn: !!user, addresses, values, stripeJsUrl: getConfig().stripeJsUrl, origin: getConfig().publicOrigin };
}

type Result =
  | { step: "details"; values: CheckoutValues; fieldErrors: FieldErrors; message: string | null }
  | { step: "review"; values: CheckoutValues; quote: Quote; fieldErrors: FieldErrors; message: string | null }
  | { step: "pay"; values: CheckoutValues; placed: Placed };

const NOT_NOW = "We could not do that right now. Please try again in a moment.";

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const intent = String(form.get("intent") ?? "");
  if (intent !== "quote" && intent !== "pay") throw new Response("Bad request", { status: 400 });
  const guest = !session.token;
  const values = readCheckoutValues(form);
  const fieldErrors = validateCheckout(values, guest);
  const details = (message: string | null, errors: FieldErrors = fieldErrors, status = 400) => formError({ step: "details", values, fieldErrors: errors, message } satisfies Result, status);
  if (Object.keys(fieldErrors).length) return details(null);

  const ctx = apiCtx(request, context, session);
  const address = { country: values.country, ...(values.region ? { region: values.region } : {}), postalCode: values.postalCode };
  try {
    // the groups the buyer was shown come from the SERVER's own quote of this cart, never from ids in the form
    const base = await api.quote(ctx, session.cart, { address, selections: [] });
    const selections = readSelections(form, groupsOf(base));
    if (intent === "quote") {
      const quote = selections.length ? await api.quote(ctx, session.cart, { address, selections }) : base;
      return formError({ step: "review", values, quote, fieldErrors: {}, message: null } satisfies Result, 200);
    }
    const quoteHash = String(form.get("quoteHash") ?? "");
    const placed = await api.placeOrder(ctx, session.cart, {
      address: { name: values.fullName, line1: values.line1, ...(values.line2 ? { line2: values.line2 } : {}), city: values.city, ...(values.region ? { region: values.region } : {}), postalCode: values.postalCode, country: values.country, ...(values.phone ? { phone: values.phone } : {}) },
      selections, ...(values.giftMessage ? { giftMessage: values.giftMessage } : {}), quoteHash, ...(guest ? { email: values.email } : {}),
    });
    // A guest's order-access token goes into the sealed cookie (never into the page): the confirmation page follows the order with it.
    const headers: Record<string, string> = { ...privateHeaders };
    if (guest && placed.guestOrderToken) headers["Set-Cookie"] = sessionCookie({ ...session, go: withGrant(session.go, { n: placed.orderNumber, t: placed.guestOrderToken, e: guestExpiry(placed.guestOrderTokenExpiresAt) }) }, getConfig());
    const { guestOrderToken: _t, ...rest } = placed;
    void _t;
    // a key that is not a publishable test/live key (or a live key outside production) is never handed to the browser: the page then says payments are unavailable
    const publicPlaced = rest.payment && !publishableKeyOk(rest.payment.publishableKey, getConfig().allowLiveStripeKeys) ? { ...rest, payment: { ...rest.payment, publishableKey: null } } : rest;
    return formError({ step: "pay", values, placed: publicPlaced } satisfies Result, 200, headers);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 409 && e.code === "price_changed") {
        const fresh = (e.body as { quote?: Quote } | undefined)?.quote;
        if (fresh) return formError({ step: "review", values, quote: fresh, fieldErrors: {}, message: "The price or delivery changed while you were checking out. Please review the new total and pay again." } satisfies Result, 200);
      }
      if (e.status === 409 && (e.code === "cart_not_ready" || e.code === "delivery_unavailable")) {
        return details(e.code === "delivery_unavailable" ? "We can't deliver part of your cart to that address. Check the address or change your cart." : "Something in your cart is no longer available. Please review your cart.", {});
      }
      if (e.status === 409 && e.code === "checkout_in_progress") return details("A payment for this cart is still being processed. Please wait a moment before changing it.", {});
      if (e.status === 409 && e.code === "checkout_superseded") return details("Another checkout of this cart replaced this one. Please start again.", {});
      if (e.status === 422 && e.code === "amount_too_large") return details("This order is too large to pay in one go. Please split it.", {});
      if (e.status === 422 && e.fieldErrors) return details(null, safeFieldErrors(e.fieldErrors, ["address", "email", "region", "postalCode", "country"]));
      if (e.status === 422) return details("Check the address (for the US, include the state) and try again.", {});
      if (e.status === 401) return details("Please sign in again, or check out as a guest.", {});
    }
    return details(NOT_NOW, {}, 503);
  }
}

export default function Checkout({ loaderData }: Route.ComponentProps) {
  const { cart, signedIn, addresses, values: initial, stripeJsUrl, origin } = loaderData;
  const a = useActionData<typeof action>() as Result | undefined;
  const busy = useNavigation().state !== "idle";
  const values = a?.values ?? initial;
  const errors = a && "fieldErrors" in a ? a.fieldErrors : {};
  const message = a && "message" in a ? a.message : null;

  if (a?.step === "pay" && a.placed.payment) {
    const p = a.placed;
    return (
      <div className="stack">
        <h1>Pay for your order</h1>
        <Card className="stack">
          <p style={{ margin: 0 }}>Order <strong>{p.orderNumber}</strong>. Total <strong>{formatMoney(p.quote.totalCents, p.quote.currency)}</strong>.</p>
          <PaymentStep clientSecret={p.payment!.clientSecret} publishableKey={p.payment!.publishableKey} stripeJsUrl={stripeJsUrl} returnUrl={`${origin}/checkout/confirmation/${encodeURIComponent(p.orderNumber)}`} totalLabel={formatMoney(p.quote.totalCents, p.quote.currency)} />
          <noscript><p role="alert">Paying needs JavaScript, because the card form comes from our payment provider.</p></noscript>
        </Card>
      </div>
    );
  }
  const quote = a?.step === "review" ? a.quote : null;
  return (
    <div className="stack">
      <h1>Checkout</h1>
      <p className="muted" style={{ margin: 0 }}><Link to="/cart">Back to your cart</Link> ({cart.itemCount} {cart.itemCount === 1 ? "item" : "items"}, {formatMoney(cart.subtotalCents, cart.currency)})</p>
      <ErrorSummary submission={a} message={message} errors={errors} />
      {!signedIn && <p>Checking out as a guest. <Link to="/sign-in?next=%2Fcheckout">Sign in</Link> to use your saved addresses and keep your orders in one place.</p>}
      {signedIn && addresses.length > 0 && (
        <nav aria-label="Saved addresses"><p style={{ margin: 0 }}>Use a saved address:</p>
          <ul className="row" style={{ listStyle: "none", padding: 0 }}>{addresses.map((ad) => <li key={ad.id}><Link to={`/checkout?address=${encodeURIComponent(ad.id)}`} className="btn btn-secondary">{ad.fullName}, {ad.line1}</Link></li>)}</ul>
        </nav>
      )}
      <Form method="post" className="stack" noValidate>
        <CsrfField />
        {!signedIn && <Input label="Email" name="email" type="email" autoComplete="email" defaultValue={values.email} error={errors.email} hint="We send your order confirmation and tracking link here." required />}
        <Input label="Full name" name="fullName" autoComplete="name" defaultValue={values.fullName} error={errors.fullName} required />
        <Input label="Street address" name="line1" autoComplete="address-line1" defaultValue={values.line1} error={errors.line1} required />
        <Input label="Apartment, suite, etc. (optional)" name="line2" autoComplete="address-line2" defaultValue={values.line2} error={errors.line2} />
        <Input label="City" name="city" autoComplete="address-level2" defaultValue={values.city} error={errors.city} required />
        <Input label="State / region" name="region" autoComplete="address-level1" defaultValue={values.region} error={errors.region} hint="For the United States, the two-letter state, for example NY." />
        <Input label="Postal code" name="postalCode" autoComplete="postal-code" defaultValue={values.postalCode} error={errors.postalCode} required />
        <Select label="Country" name="country" autoComplete="country" defaultValue={values.country} error={errors.country}>
          {Object.entries(COUNTRIES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </Select>
        <Input label="Phone (optional)" name="phone" type="tel" autoComplete="tel" defaultValue={values.phone} error={errors.phone} hint="Only used by the carrier for delivery questions." />
        <Input label="Gift message (optional)" name="giftMessage" defaultValue={values.giftMessage} error={errors.giftMessage} hint="Up to 500 characters; the seller prints or includes it." />
        {quote && <DeliveryAndTotals quote={quote} />}
        <div className="row">
          <Button type="submit" name="intent" value="quote" variant={quote ? "secondary" : "primary"} disabled={busy}>{quote ? "Update delivery and total" : "Continue to delivery"}</Button>
          {quote && quote.canPay && <Button type="submit" name="intent" value="pay" variant="primary" disabled={busy}>Place order and pay {formatMoney(quote.totalCents, quote.currency)}</Button>}
        </div>
        {quote && !quote.canPay && <p role="alert">We can't deliver every item to this address. Change the address or go back to your cart.</p>}
      </Form>
    </div>
  );
}

function DeliveryAndTotals({ quote }: { quote: Quote }) {
  return (
    <section className="stack" aria-labelledby="delivery-h" data-testid="checkout-review">
      <h2 id="delivery-h">Delivery and total</h2>
      <input type="hidden" name="quoteHash" value={quote.quoteHash} />
      {quote.groups.map((g) => {
        const field = deliveryField(g);
        const chosen = selectedValue(g);
        return (
          <fieldset key={field} className="card stack" data-testid="delivery-group">
            <legend>{g.brandName || g.sellerName} ({g.lines.reduce((n, l) => n + l.quantity, 0)} {g.lines.reduce((n, l) => n + l.quantity, 0) === 1 ? "item" : "items"}, {formatMoney(g.itemsCents, quote.currency)})</legend>
            {g.shippingOptions.length === 0 && !g.local?.eligible && <p role="alert">This seller can't deliver to that address.</p>}
            {g.shippingOptions.map((o) => (
              <label key={o.speed} className="check">
                <input type="radio" name={field} value={carrierValue(o.speed)} defaultChecked={chosen === carrierValue(o.speed)} />
                <span>{o.speed.charAt(0).toUpperCase() + o.speed.slice(1)}: {o.free ? "free" : formatMoney(o.priceCents, quote.currency)}, {estimateText(o.estimate)}</span>
              </label>
            ))}
            {g.local?.eligible && g.local.windows.filter((w) => w.remaining > 0).map((w) => (
              <label key={`${w.windowId}:${w.date}`} className="check">
                <input type="radio" name={field} value={localValue(w.windowId, w.date)} defaultChecked={chosen === localValue(w.windowId, w.date)} />
                <span>Local delivery {w.date}, {w.start.slice(11, 16)} to {w.end.slice(11, 16)} UTC: {formatMoney(g.local?.feeCents ?? 0, quote.currency)}</span>
              </label>
            ))}
            {g.unavailableSpeeds.length > 0 && <p className="muted" style={{ margin: 0 }}>Some speeds are not offered for these items.</p>}
          </fieldset>
        );
      })}
      <dl className="stack" data-testid="checkout-totals" style={{ margin: 0 }}>
        <div className="row" style={{ justifyContent: "space-between" }}><dt>Items</dt><dd style={{ margin: 0 }}>{formatMoney(quote.itemsCents, quote.currency)}</dd></div>
        <div className="row" style={{ justifyContent: "space-between" }}><dt>Shipping</dt><dd style={{ margin: 0 }}>{formatMoney(quote.shippingCents, quote.currency)}</dd></div>
        <div className="row" style={{ justifyContent: "space-between" }}><dt>Tax</dt><dd style={{ margin: 0 }}>{formatMoney(quote.taxCents, quote.currency)}</dd></div>
        <div className="row" style={{ justifyContent: "space-between" }}><dt><strong>Total</strong></dt><dd style={{ margin: 0 }}><strong data-testid="checkout-total">{formatMoney(quote.totalCents, quote.currency)}</strong></dd></div>
      </dl>
    </section>
  );
}
