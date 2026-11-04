import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/form";

/** The slice of Stripe.js we use (the Payment Element). Types are declared here so no Stripe package is bundled: the script is loaded from Stripe's own origin, as Stripe requires. */
interface StripeElement { mount(selector: string): void; destroy?(): void }
interface StripeElements { create(kind: "payment", options?: Record<string, unknown>): StripeElement }
interface StripeInstance {
  elements(options: { clientSecret: string }): StripeElements;
  confirmPayment(args: { elements: StripeElements; confirmParams: { return_url: string } }): Promise<{ error?: { message?: string; type?: string } }>;
}
declare global { interface Window { Stripe?: (publishableKey: string) => StripeInstance } }

let loading: Promise<void> | null = null;
function loadStripeJs(src: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Stripe) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error("load")); };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * The payment step: Stripe's Payment Element mounted into a box of ours. The PaymentIntent was created by the API for exactly the quoted total; the browser only ever holds its client
 * secret (meant for the browser) and the PUBLISHABLE key. Card data goes from Stripe's iframe to Stripe, never through our servers. After paying, Stripe sends the buyer to `returnUrl`;
 * the order's real status comes from the API (the webhook), never from the redirect's query string.
 */
export function PaymentStep({ clientSecret, publishableKey, stripeJsUrl, returnUrl, totalLabel }: { clientSecret: string; publishableKey: string | null; stripeJsUrl: string; returnUrl: string; totalLabel: string }) {
  const [state, setState] = useState<"loading" | "ready" | "paying" | "unavailable">(publishableKey ? "loading" : "unavailable");
  const [error, setError] = useState<string | null>(null);
  const stripe = useRef<StripeInstance | null>(null);
  const elements = useRef<StripeElements | null>(null);

  useEffect(() => {
    if (!publishableKey) return;
    let cancelled = false;
    loadStripeJs(stripeJsUrl).then(() => {
      if (cancelled || !window.Stripe) return;
      stripe.current = window.Stripe(publishableKey);
      elements.current = stripe.current.elements({ clientSecret });
      elements.current.create("payment").mount("#payment-element");
      setState("ready");
    }).catch(() => { if (!cancelled) setState("unavailable"); });
    return () => { cancelled = true; };
  }, [clientSecret, publishableKey, stripeJsUrl]);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe.current || !elements.current) return;
    setError(null);
    setState("paying");
    const { error: err } = await stripe.current.confirmPayment({ elements: elements.current, confirmParams: { return_url: returnUrl } });
    // Only returns when the payment was not confirmed (it redirects otherwise). Stripe's own message is for the buyer (declines, validation), but we cap it.
    setError((err?.message ?? "The payment could not be completed. Please check your details and try again.").slice(0, 300));
    setState("ready");
  }

  if (state === "unavailable") {
    return <p role="alert" data-testid="payment-unavailable">Payments are not available right now. Your order is saved for a short while: please try again in a few minutes.</p>;
  }
  return (
    <form onSubmit={pay} className="stack" data-testid="payment-step" aria-label="Payment">
      <div id="payment-element" aria-live="polite">{state === "loading" && <p className="muted">Loading the secure payment form…</p>}</div>
      {error && <p role="alert" data-testid="payment-error">{error}</p>}
      <Button type="submit" variant="primary" disabled={state !== "ready"}>{state === "paying" ? "Paying…" : `Pay ${totalLabel}`}</Button>
      <p className="muted" style={{ margin: 0 }}>Your card details go straight to Stripe. We never see them.</p>
    </form>
  );
}
