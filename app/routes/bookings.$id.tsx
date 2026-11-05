import { useEffect, useRef, useState } from "react";
import { Link, data, redirect, useFetcher, useRevalidator } from "react-router";
import type { Route } from "./+types/bookings.$id";
import { CsrfField } from "~/components/Shell";
import { PaymentStep } from "~/components/PaymentStep";
import { Badge, Card, formatMoney } from "~/components/ui/display";
import { Button, Input, Select } from "~/components/ui/form";
import { ApiError, api, type BookingPayment, type ServiceOptions } from "~/lib/api-client.server";
import { assertCsrf, failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { apiLocation, badgeTone, bookingStatus, CALENDAR_STATUSES, CANCELLABLE, countdown, EXTRA_CHARGE_TEXT, groupSlotsByDay, newHoldKey, policyLines, safeZone, secondsLeft, servicePath, type Availability, type BookingView } from "~/lib/bookings";
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
  slot_unavailable: "That time was just taken. Please choose another.",
  reschedule_limit: "This booking cannot be moved again.",
  too_late: "It is too late to move this booking.",
  no_proposal: "There is no suggested time to answer any more.",
  nothing_requested: "There is no additional amount to answer any more.",
  amount_changed: "The provider changed the amount. The page now shows the new amount: please look at it and agree again.",
  nothing_to_accept: "There is nothing to accept any more.",
  [DEMO_REFUSED_CODE]: DEMO_REFUSED_TEXT,
  unavailable: "We could not do that just now. Please try again in a moment.",
};
const failure = (e: unknown): string => (e instanceof ApiError && e.status === 409 && /^(hold_expired|already_paid|nothing_requested|amount_changed|invalid_state|slot_unavailable|reschedule_limit|too_late|no_proposal|nothing_to_accept|demo_data)$/.test(e.code) ? e.code : e instanceof ApiError && e.status === 422 ? "invalid" : "unavailable");

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
    if (intent === "reschedule") {
      const newStart = String(form.get("newStart") ?? "");
      if (Number.isNaN(Date.parse(newStart))) throw data("Bad request", { status: 400, headers: privateHeaders });
      const key = /^[A-Za-z0-9\-_]{8,60}$/.test(String(form.get("key") ?? "")) ? String(form.get("key")) : newHoldKey().slice(0, 50);
      await api.rescheduleBooking(ctx, params.id, new Date(newStart).toISOString(), key);
      return redirect(`/bookings/${encodeURIComponent(params.id)}`, { headers: privateHeaders });
    }
    if (intent === "proposal") {
      await api.bookingProposal(ctx, params.id, String(form.get("accept") ?? "") === "yes");
      return redirect(`/bookings/${encodeURIComponent(params.id)}`, { headers: privateHeaders });
    }
    if (intent === "acknowledge") {
      await api.acknowledgeReschedule(ctx, params.id);
      return redirect(`/bookings/${encodeURIComponent(params.id)}`, { headers: privateHeaders });
    }
    if (intent === "extra-accept") {
      const seen = Number(form.get("expectedAmountCents") ?? "");
      const r = await api.extraChargeAccept(ctx, params.id, Number.isInteger(seen) && seen > 0 ? seen : undefined);
      return data({ payment: r.payment as BookingPayment, amountCents: r.amountCents, error: null as string | null }, { headers: privateHeaders });
    }
    if (intent === "extra-decline") {
      await api.extraChargeDecline(ctx, params.id);
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
  const waiting = returned && (WAITING_AFTER_PAYMENT.has(booking.status) || !!booking.needsPayment);
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

      {booking.status !== "Hold" && <ChangePanel booking={booking} />}
      {booking.extraChargeState && booking.extraChargeState !== "none" && <ExtraChargePanel booking={booking} stripeJsUrl={stripeJsUrl} returnUrl={`${origin}/bookings/${encodeURIComponent(booking.id)}`} />}
      {policyLines(booking.policy).length > 0 && (
        <section aria-labelledby="policy-h" className="stack">
          <h2 id="policy-h" style={{ fontSize: "1rem", margin: 0 }}>Cancellation policy</h2>
          <ul data-testid="booking-policy" style={{ margin: 0, paddingLeft: "1.2em" }}>{policyLines(booking.policy).map((l) => <li key={l}>{l}</li>)}</ul>
        </section>
      )}
      {CALENDAR_STATUSES.has(booking.status) && <p><a href={`/bookings/${encodeURIComponent(booking.id)}/calendar.ics`} download data-testid="ics-link">Add to your calendar (.ics)</a></p>}
      {booking.status === "Hold" && !booking.holdExpired && !waiting && (
        <HoldPanel booking={booking} questions={questions} serverNow={serverNow} busy={fetcher.state !== "idle"} payment={payment} error={error}
          fetcher={fetcher} stripeJsUrl={stripeJsUrl} returnUrl={`${origin}/bookings/${encodeURIComponent(booking.id)}`} />
      )}
      {booking.needsPayment && !waiting && <DuePanel booking={booking} serverNow={serverNow} stripeJsUrl={stripeJsUrl} returnUrl={`${origin}/bookings/${encodeURIComponent(booking.id)}`} />}
      {(booking.status === "Hold" && booking.holdExpired) && (
        <div className="stack">
          <p role="alert">{BOOKING_PAGE_MESSAGES["hold_expired"]}</p>
          {servicePath(booking.listingSlug) && <p><Link to={servicePath(booking.listingSlug)!} data-testid="choose-again">Choose a time again</Link></p>}
        </div>
      )}
      {booking.status === "Expired" && servicePath(booking.listingSlug) && <p><Link to={servicePath(booking.listingSlug)!} data-testid="choose-again">Choose a time again</Link></p>}

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


/**
 * What the buyer can do about a booking's time: answer the provider's suggested time, accept (or refuse by cancelling) a time the provider moved, or ask for another time. Every action is a
 * plain form post; the API decides what is allowed and the page shows its answer in fixed words.
 */
function ChangePanel({ booking }: { booking: BookingView }) {
  const fetcher = useFetcher<{ payment: BookingPayment | null; error: string | null }>();
  const error = fetcher.data?.error ? BOOKING_PAGE_MESSAGES[fetcher.data.error] ?? BOOKING_PAGE_MESSAGES["unavailable"] : null;
  const busy = fetcher.state !== "idle";
  const [asking, setAsking] = useState(false);
  const live = booking.status === "Requested" || booking.status === "Confirmed" || booking.status === "Rescheduled";
  const canChange = booking.status === "Confirmed" || booking.status === "Rescheduled";      // a request the provider has not answered yet is not moved (the provider decides first)
  if (!live) return null;
  return (
    <div className="stack" data-testid="change-panel">
      {booking.proposedStartAt && (
        <Card className="stack">
          <p style={{ margin: 0 }}>The provider suggested <strong>{formatDate(booking.proposedStartAt, true)}</strong>.</p>
          <fetcher.Form method="post" className="row" aria-label="Answer the suggested time">
            <CsrfField /><input type="hidden" name="intent" value="proposal" />
            <Button type="submit" name="accept" value="yes" variant="primary" disabled={busy}>Accept this time</Button>
            <Button type="submit" name="accept" value="no" variant="secondary" disabled={busy}>Keep my time</Button>
          </fetcher.Form>
        </Card>
      )}
      {booking.requiresBuyerConsent && (
        <Card className="stack">
          <p style={{ margin: 0 }}>The provider moved your booking to <strong>{booking.startAt ? formatDate(booking.startAt, true) : "a new time"}</strong>. Accept it, or cancel for free below.</p>
          <fetcher.Form method="post" aria-label="Accept the new time">
            <CsrfField /><input type="hidden" name="intent" value="acknowledge" />
            <Button type="submit" variant="primary" disabled={busy}>Accept the new time</Button>
          </fetcher.Form>
        </Card>
      )}
      {booking.rescheduleRequestedStartAt && <p className="muted" data-testid="reschedule-pending">You asked to move this booking to {formatDate(booking.rescheduleRequestedStartAt, true)}. The provider will answer.</p>}
      {error && <p role="alert" data-testid="change-error">{error}</p>}
      {canChange && (asking
        ? <RescheduleForm booking={booking} fetcher={fetcher} busy={busy} onClose={() => setAsking(false)} />
        : <div><Button type="button" variant="secondary" onClick={() => setAsking(true)}>Change the time</Button></div>)}
    </div>
  );
}

function RescheduleForm({ booking, fetcher, busy, onClose }: { booking: BookingView; fetcher: ReturnType<typeof useFetcher<{ payment: BookingPayment | null; error: string | null }>>; busy: boolean; onClose: () => void }) {
  const loc = apiLocation(booking.location === "customer" ? "at-home" : booking.location === "seller" ? "at-seller" : "online");
  const [postal, setPostal] = useState("");
  const [asked, setAsked] = useState(loc === "customer" ? "" : "-");       // an at-home booking needs the postal code again (the booking view carries no address)
  const [res, setRes] = useState<{ key: string; result: Availability | null } | null>(null);
  const [key, setKey] = useState(() => newHoldKey().slice(0, 50));
  const wasBusy = useRef(false);
  useEffect(() => {      // one key per attempt: after an answer (a refusal included) the next submission is a new request
    if (busy) wasBusy.current = true;
    else if (wasBusy.current) { wasBusy.current = false; setKey(newHoldKey().slice(0, 50)); }
  }, [busy]);
  const reqKey = asked ? `${booking.listingId}|${loc}|${asked}` : null;
  useEffect(() => {
    if (!reqKey) return;
    const ctrl = new AbortController();
    const q = new URLSearchParams({ location: loc });
    if (asked && asked !== "-") q.set("postalCode", asked);
    fetch(`/services/${encodeURIComponent(booking.listingId)}/availability?${q}`, { signal: ctrl.signal, headers: { Accept: "application/json" } })
      .then(async (r) => setRes({ key: reqKey, result: r.ok ? ((await r.json()) as Availability) : null }))
      .catch((e: unknown) => { if (!(e instanceof DOMException && e.name === "AbortError")) setRes({ key: reqKey, result: null }); });
    return () => ctrl.abort();
  }, [reqKey, loc, asked, booking.listingId]);
  const current = res && res.key === reqKey ? res : null;
  const days = current?.result ? groupSlotsByDay(current.result.slots, safeZone(current.result.providers[0]?.timeZone)) : [];
  const tz = safeZone(current?.result?.providers[0]?.timeZone);
  return (
    <fetcher.Form method="post" className="stack" aria-label="Choose another time">
      <CsrfField /><input type="hidden" name="intent" value="reschedule" /><input type="hidden" name="key" value={key} />
      {loc === "customer" && (
        <div className="row">
          <Input label="Your postal code" name="postal" value={postal} onChange={(e) => setPostal(e.target.value)} autoComplete="postal-code" maxLength={20} />
          <Button type="button" variant="secondary" onClick={() => setAsked(postal.trim())} disabled={!postal.trim()}>Show times</Button>
        </div>
      )}
      {reqKey && !current && <p className="muted" role="status">Finding times…</p>}
      {current && !current.result && <p role="alert" data-testid="reschedule-error">We could not load other times just now. Please try again in a moment.</p>}
      {current?.result && days.length === 0 && <p className="muted">No other times are open in the next two weeks.</p>}
      {days.length > 0 && (
        <Select label={`New time (${tz.replace(/_/g, " ")})`} name="newStart" required defaultValue="">
          <option value="" disabled>Choose a time…</option>
          {days.map((d) => <optgroup key={d.key} label={d.label}>{d.slots.map((s) => <option key={s.startAt} value={s.startAt}>{s.label}</option>)}</optgroup>)}
        </Select>
      )}
      <div className="row">
        <Button type="submit" variant="primary" disabled={busy || days.length === 0}>{busy ? "One moment…" : "Ask for this time"}</Button>
        <Button type="button" variant="secondary" onClick={onClose}>Never mind</Button>
      </div>
    </fetcher.Form>
  );
}


/**
 * An amount the provider asks for after the work (more time than booked, for instance). The buyer consents first (that creates the payment for exactly that amount) and pays with the same
 * Payment Element as a booking; declining ends the request. The state and the amount come from the API.
 */
function ExtraChargePanel({ booking, stripeJsUrl, returnUrl }: { booking: BookingView; stripeJsUrl: string; returnUrl: string }) {
  const fetcher = useFetcher<{ payment: BookingPayment | null; amountCents?: number; error: string | null }>();
  const state = booking.extraChargeState ?? "";
  const amount = booking.additionalChargeCents ?? 0;
  const payment = fetcher.data?.payment ?? null;
  const payable = fetcher.data?.amountCents ?? amount;          // what is paid is the amount the API answered with, never a stale figure from the page
  const { revalidate } = useRevalidator();
  useEffect(() => { if (fetcher.data?.error === "amount_changed") void revalidate(); }, [fetcher.data, revalidate]);   // a refused answer does not reload the page by itself: show the new amount
  const error = fetcher.data?.error ? BOOKING_PAGE_MESSAGES[fetcher.data.error] ?? BOOKING_PAGE_MESSAGES["unavailable"] : null;
  const busy = fetcher.state !== "idle";
  const text = EXTRA_CHARGE_TEXT[state];
  if (!text) return null;
  return (
    <Card className="stack" data-testid="extra-charge">
      <p style={{ margin: 0 }}>{text}{amount > 0 ? <> Amount: <strong>{formatMoney(amount, booking.currency)}</strong>.</> : null}</p>
      {(state === "requested" || state === "consented") && !payment && (
        <div className="row">
          <fetcher.Form method="post" aria-label="Agree to the additional amount">
            <CsrfField /><input type="hidden" name="intent" value="extra-accept" /><input type="hidden" name="expectedAmountCents" value={amount} />
            <Button type="submit" variant="primary" disabled={busy}>{state === "consented" ? "Continue to payment" : "Agree and pay"}</Button>
          </fetcher.Form>
          {state === "requested" && (
            <fetcher.Form method="post" aria-label="Decline the additional amount">
              <CsrfField /><input type="hidden" name="intent" value="extra-decline" />
              <Button type="submit" variant="secondary" disabled={busy}>Decline</Button>
            </fetcher.Form>
          )}
        </div>
      )}
      {payment && <PaymentStep clientSecret={payment.clientSecret} publishableKey={payment.publishableKey} stripeJsUrl={stripeJsUrl} returnUrl={returnUrl} totalLabel={formatMoney(payable, booking.currency)} />}
      {error && <p role="alert" data-testid="extra-error">{error}</p>}
    </Card>
  );
}


/**
 * A confirmed booking that is still unpaid (a quote accepted before the portal began holding the time): the buyer must pay by `paymentDueAt` or it is cancelled, so the payment is offered
 * here, like a hold's. The countdown starts from the server's clock.
 */
function DuePanel({ booking, serverNow, stripeJsUrl, returnUrl }: { booking: BookingView; serverNow: number; stripeJsUrl: string; returnUrl: string }) {
  const fetcher = useFetcher<{ payment: BookingPayment | null; error: string | null }>();
  const [now, setNow] = useState(serverNow);
  useEffect(() => { const t0 = Date.now(); const t = setInterval(() => setNow(serverNow + (Date.now() - t0)), 1000); return () => clearInterval(t); }, [serverNow]);
  const left = secondsLeft(booking.paymentDueAt ?? null, now);
  const payment = fetcher.data?.payment ?? null;
  const error = fetcher.data?.error ? BOOKING_PAGE_MESSAGES[fetcher.data.error] ?? BOOKING_PAGE_MESSAGES["unavailable"] : null;
  if (left === 0) return <p role="alert">The time to pay for this booking has passed.</p>;
  return (
    <Card className="stack" data-testid="due-panel">
      <p style={{ margin: 0 }}>This booking is confirmed but not paid. Pay within <strong data-testid="due-countdown">{countdown(left)}</strong> or it is cancelled.</p>
      {payment
        ? <PaymentStep clientSecret={payment.clientSecret} publishableKey={payment.publishableKey} stripeJsUrl={stripeJsUrl} returnUrl={returnUrl} totalLabel={formatMoney(booking.totalCents, booking.currency)} />
        : (
          <fetcher.Form method="post" aria-label="Pay for this booking">
            <CsrfField /><input type="hidden" name="intent" value="checkout" />
            <Button type="submit" variant="primary" disabled={fetcher.state !== "idle"}>{fetcher.state !== "idle" ? "One moment…" : `Continue to payment · ${formatMoney(booking.totalCents, booking.currency)}`}</Button>
          </fetcher.Form>
        )}
      {error && <p role="alert" data-testid="due-error">{error}</p>}
    </Card>
  );
}
