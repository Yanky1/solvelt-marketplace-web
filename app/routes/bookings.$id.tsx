import { useEffect, useState } from "react";
import { Link, data, redirect, useFetcher, useRevalidator } from "react-router";
import type { Route } from "./+types/bookings.$id";
import { CsrfField } from "~/components/Shell";
import { PaymentStep } from "~/components/PaymentStep";
import { Badge, Card, formatMoney } from "~/components/ui/display";
import { Button, Input, Select } from "~/components/ui/form";
import { ApiError, api, type BookingPayment, type ServiceOptions } from "~/lib/api-client.server";
import { assertCsrf, failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { badgeTone, bookingStatus, CANCELLABLE, countdown, secondsLeft, type BookingView } from "~/lib/bookings";
import { getConfig } from "~/lib/config.server";
import { isSafeId } from "~/lib/passkey.server";
import { formatDate } from "~/lib/orders";
import { DEMO_REFUSED_CODE, DEMO_REFUSED_TEXT } from "~/lib/demo";

export function meta() {
  return [{ title: "Your booking | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

/** What the page says for the short codes the actions give. */
export const BOOKING_PAGE_MESSAGES: Record<string, string> = {
  hold_expired: "The hold ran out. Please choose a time again.",
  already_paid: "This booking is already paid.",
  invalid: "Please check your answers and try again.",
  invalid_state: "This booking can no longer be changed.",
  [DEMO_REFUSED_CODE]: DEMO_REFUSED_TEXT,
  unavailable: "We could not do that just now. Please try again in a moment.",
};
const failure = (e: unknown): string => (e instanceof ApiError && e.status === 409 && /^(hold_expired|already_paid|invalid_state|demo_data)$/.test(e.code) ? e.code : e instanceof ApiError && e.status === 422 ? "invalid" : "unavailable");

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(params.id)) throw data("Not found", { status: 404, headers: privateHeaders });
  try {
    const booking = await api.booking(ctx, params.id);
    let options: ServiceOptions | null = null;
    if (booking.status === "Hold" && !booking.holdExpired) options = await api.serviceOptions(ctx, booking.listingId).catch(() => null);
    const preview = CANCELLABLE.has(booking.status) && booking.status !== "Hold" ? await api.cancelBookingPreview(ctx, params.id).catch(() => null) : null;
    const cfg = getConfig();
    return data({ booking, questions: options?.intakeQuestions ?? [], preview, stripeJsUrl: cfg.stripeJsUrl, origin: cfg.publicOrigin, serverNow: Date.now() }, { headers: privateHeaders });
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(params.id)) throw data("Not found", { status: 404, headers: privateHeaders });
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "cancel") {
      await api.cancelBooking(ctx, params.id, String(form.get("reason") ?? "").slice(0, 300) || undefined);
      return redirect(`/bookings/${encodeURIComponent(params.id)}`, { headers: privateHeaders });
    }
    if (intent === "checkout") {
      const intake: { id: string; answer: string }[] = [];
      for (const [k, v] of form.entries()) if (k.startsWith("intake.") && typeof v === "string" && v.trim()) intake.push({ id: k.slice(7), answer: v.trim().slice(0, 2000) });
      const phone = String(form.get("phone") ?? "").trim().slice(0, 40);
      const r = await api.checkoutBooking(ctx, params.id, { ...(intake.length ? { intake: intake.slice(0, 30) } : {}), ...(phone ? { phone } : {}) });
      return data({ payment: r.payment as BookingPayment, error: null as string | null }, { headers: privateHeaders });
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return failAccount(e, request);
    return data({ payment: null as BookingPayment | null, error: failure(e) }, { status: e instanceof ApiError && e.status < 500 ? e.status : 503, headers: privateHeaders });
  }
  throw data("Bad request", { status: 400, headers: privateHeaders });
}

const WAITING_AFTER_PAYMENT = new Set(["Hold"]);

export default function BookingPage({ loaderData }: Route.ComponentProps) {
  const { booking, questions, preview, stripeJsUrl, origin, serverNow } = loaderData;
  const st = bookingStatus(booking.status);
  const fetcher = useFetcher<{ payment: BookingPayment | null; error: string | null }>();
  const cancel = useFetcher();
  const { revalidate, state } = useRevalidator();
  const returned = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("redirect_status");   // Stripe sends the buyer back with this
  const waiting = returned && WAITING_AFTER_PAYMENT.has(booking.status);
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    const t = setInterval(() => { if (++n > 40) clearInterval(t); else if (state === "idle") revalidate(); }, 3000);   // the status comes from the API (the webhook), never from the redirect's query string
    return () => clearInterval(t);
  }, [waiting, revalidate, state]);

  const payment = fetcher.data?.payment ?? null;
  const error = fetcher.data?.error ? BOOKING_PAGE_MESSAGES[fetcher.data.error] ?? BOOKING_PAGE_MESSAGES["unavailable"] : null;

  return (
    <div className="stack">
      <h1>{booking.number ? `Booking ${booking.number}` : "Your booking"}</h1>
      <div className="row"><Badge tone={badgeTone(st.tone)}>{st.label}</Badge></div>
      <p role="status" data-testid="booking-status" data-status={booking.status}>{waiting ? "We are confirming your payment. This page checks by itself every few seconds." : st.text}</p>
      <Card className="stack">
        {booking.startAt && <p style={{ margin: 0 }}><strong>{formatDate(booking.startAt, true)}</strong>{booking.durationMinutes ? <span className="muted"> · {booking.durationMinutes} min</span> : null}</p>}
        <p style={{ margin: 0 }}>Total <strong>{formatMoney(booking.totalCents, booking.currency)}</strong></p>
        {booking.onlineInstructions && <p style={{ margin: 0 }}>Meeting link: <a href={booking.onlineInstructions} rel="noopener noreferrer nofollow">{booking.onlineInstructions}</a></p>}
        {booking.proposedStartAt && <p style={{ margin: 0 }}>The provider suggested another time: <strong>{formatDate(booking.proposedStartAt, true)}</strong>.</p>}
      </Card>

      {booking.status === "Hold" && !booking.holdExpired && !waiting && (
        <HoldPanel booking={booking} questions={questions} serverNow={serverNow} busy={fetcher.state !== "idle"} payment={payment} error={error}
          fetcher={fetcher} stripeJsUrl={stripeJsUrl} returnUrl={`${origin}/bookings/${encodeURIComponent(booking.id)}`} />
      )}
      {booking.status === "Hold" && booking.holdExpired && <p role="alert">{BOOKING_PAGE_MESSAGES["hold_expired"]}</p>}

      {CANCELLABLE.has(booking.status) && (
        <cancel.Form method="post" className="stack" aria-label="Cancel this booking">
          <CsrfField />
          <input type="hidden" name="intent" value="cancel" />
          {preview && <p className="muted" data-testid="cancel-preview" style={{ margin: 0 }}>
            {!preview.feeKnown ? "The provider's cancellation policy applies."
              : preview.withinFreeWindow ? "You can cancel for free." : `Cancelling now costs ${formatMoney(preview.feeCents ?? 0, preview.currency)}; ${formatMoney(preview.refundCents ?? 0, preview.currency)} is refunded.`}
          </p>}
          <div><Button type="submit" variant="secondary" disabled={cancel.state !== "idle"}>Cancel this booking</Button></div>
        </cancel.Form>
      )}
      <p><Link to="/account/bookings">All your bookings</Link></p>
    </div>
  );
}

function HoldPanel({ booking, questions, serverNow, busy, payment, error, fetcher, stripeJsUrl, returnUrl }: {
  booking: BookingView; questions: ServiceOptions["intakeQuestions"]; serverNow: number; busy: boolean; payment: BookingPayment | null; error: string | null | undefined;
  fetcher: ReturnType<typeof useFetcher<{ payment: BookingPayment | null; error: string | null }>>; stripeJsUrl: string; returnUrl: string;
}) {
  // The countdown starts from the server's clock (the browser's may be wrong) and ticks by the elapsed time since the page arrived.
  const [now, setNow] = useState(serverNow);
  useEffect(() => { const t0 = Date.now(); const t = setInterval(() => setNow(serverNow + (Date.now() - t0)), 1000); return () => clearInterval(t); }, [serverNow]);
  const left = secondsLeft(booking.holdExpiresAt, now);
  if (left === 0) return <p role="alert">{BOOKING_PAGE_MESSAGES["hold_expired"]}</p>;
  return (
    <div className="stack" data-testid="hold-panel">
      <p role="timer" aria-live="off" data-testid="hold-countdown">Held for you: <strong>{countdown(left)}</strong></p>
      {payment ? (
        <PaymentStep clientSecret={payment.clientSecret} publishableKey={payment.publishableKey} stripeJsUrl={stripeJsUrl} returnUrl={returnUrl} totalLabel={formatMoney(booking.totalCents, booking.currency)} />
      ) : (
        <fetcher.Form method="post" className="stack" aria-label="Your details">
          <CsrfField />
          <input type="hidden" name="intent" value="checkout" />
          {questions.map((q) => <Question key={q.id} q={q} />)}
          <Input label="Phone (optional)" name="phone" type="tel" autoComplete="tel" maxLength={40} hint="So the provider can reach you about this booking." />
          {error && <p role="alert" data-testid="booking-error">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "One moment…" : `Continue to payment · ${formatMoney(booking.totalCents, booking.currency)}`}</Button>
        </fetcher.Form>
      )}
    </div>
  );
}

function Question({ q }: { q: ServiceOptions["intakeQuestions"][number] }) {
  const name = `intake.${q.id}`;
  const common = { label: q.label + (q.required ? "" : " (optional)"), name, required: q.required };
  if (q.kind === "choice") return <Select {...common}><option value="">Choose…</option>{(q.choices ?? []).map((c) => <option key={c} value={c}>{c}</option>)}</Select>;
  if (q.kind === "yesNo") return <Select {...common}><option value="">Choose…</option><option value="yes">Yes</option><option value="no">No</option></Select>;
  if (q.kind === "number") return <Input {...common} type="number" inputMode="decimal" />;
  if (q.kind === "longText") {
    return (
      <div className="field">
        <label htmlFor={`q-${q.id}`}>{common.label}</label>
        <textarea id={`q-${q.id}`} name={name} className="input" rows={3} maxLength={q.maxLength ?? 2000} required={q.required} />
      </div>
    );
  }
  return <Input {...common} maxLength={q.maxLength ?? 500} />;
}
