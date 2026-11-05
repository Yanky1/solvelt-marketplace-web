import { Link, data, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/quotes.$id";
import { CsrfField } from "~/components/Shell";
import { Badge, Card, formatMoney } from "~/components/ui/display";
import { Button, Input, Select } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { badgeTone, groupSlotsByDay, quoteStatus } from "~/lib/bookings";
import { formatDate } from "~/lib/orders";
import { isSafeId } from "~/lib/passkey.server";

export function meta() {
  return [{ title: "Your quote | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export const QUOTE_MESSAGES: Record<string, string> = {
  quote_expired: "This quote is no longer valid.",
  quote_not_open: "This quote can no longer be answered.",
  slot_unavailable: "That time was just taken. Please choose another.",
  slot_not_offered: "That time is not one the provider offered.",
  invalid: "Please check your answers and try again.",
  unavailable: "We could not do that just now. Please try again in a moment.",
};
const failure = (e: unknown): string => (e instanceof ApiError && /^(quote_expired|quote_not_open|slot_unavailable|slot_not_offered)$/.test(e.code) ? e.code : e instanceof ApiError && e.status === 422 ? "invalid" : "unavailable");

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(params.id)) throw data("Not found", { status: 404, headers: privateHeaders });
  try {
    return data({ quote: await api.quoteRequest(ctx, params.id) }, { headers: privateHeaders });
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
    if (intent === "accept") {
      const start = String(form.get("start") ?? "");
      if (Number.isNaN(Date.parse(start))) return data({ error: "slot_not_offered" }, { status: 422, headers: privateHeaders });
      const phone = String(form.get("phone") ?? "").trim().slice(0, 40);
      const r = await api.acceptQuote(ctx, params.id, { start: new Date(start).toISOString(), ...(phone ? { phone } : {}) });
      return redirect(`/bookings/${encodeURIComponent(r.booking.id)}`, { headers: privateHeaders });       // the booking is a hold to pay (or, for an older quote, a booking to pay within 30 minutes)
    }
    if (intent === "decline") {
      await api.declineQuote(ctx, params.id, String(form.get("reason") ?? "").trim().slice(0, 300) || undefined);
      return redirect(`/quotes/${encodeURIComponent(params.id)}`, { headers: privateHeaders });
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return failAccount(e, request);
    return data({ error: failure(e) }, { status: e instanceof ApiError && e.status < 500 ? e.status : 503, headers: privateHeaders });
  }
  throw data("Bad request", { status: 400, headers: privateHeaders });
}

export default function QuotePage({ loaderData }: Route.ComponentProps) {
  const { quote } = loaderData;
  const st = quoteStatus(quote.status);
  const fetcher = useFetcher<{ error?: string }>();
  const error = fetcher.data?.error ? QUOTE_MESSAGES[fetcher.data.error] ?? QUOTE_MESSAGES["unavailable"] : null;
  const open = quote.status === "Quoted" && !quote.expired;
  const days = groupSlotsByDay(quote.slots.map((s) => ({ startAt: s, endAt: s, providerIds: [] })), "UTC");
  return (
    <div className="stack">
      <h1>Your quote request</h1>
      <div className="row"><Badge tone={badgeTone(st.tone)}>{st.label}</Badge></div>
      <p role="status" data-testid="quote-status" data-status={quote.status}>{quote.expired && quote.status === "Quoted" ? quoteStatus("Expired").text : st.text}</p>
      <Card className="stack">
        <p style={{ margin: 0 }} data-testid="quote-details">{quote.details}</p>
        {quote.priceCents != null && <p style={{ margin: 0 }}>Price <strong data-testid="quote-price">{formatMoney(quote.priceCents, quote.currency)}</strong>{quote.durationMinutes ? <span className="muted"> · {quote.durationMinutes} min</span> : null}</p>}
        {quote.note && <p style={{ margin: 0 }}>Provider's note: {quote.note}</p>}
        {quote.expiresAt && quote.status === "Quoted" && <p className="muted" style={{ margin: 0 }}>Valid until {formatDate(quote.expiresAt, true)}.</p>}
        {quote.declineReason && <p style={{ margin: 0 }}>{quote.declineReason}</p>}
      </Card>
      {open && (
        <fetcher.Form method="post" className="stack" aria-label="Accept this quote">
          <CsrfField /><input type="hidden" name="intent" value="accept" />
          <Select label="Choose a time (UTC)" name="start" required defaultValue="">
            <option value="" disabled>Choose a time…</option>
            {days.map((d) => <optgroup key={d.key} label={d.label}>{d.slots.map((s) => <option key={s.startAt} value={s.startAt}>{s.label}</option>)}</optgroup>)}
          </Select>
          <Input label="Phone (optional)" name="phone" type="tel" autoComplete="tel" maxLength={40} />
          {error && <p role="alert" data-testid="quote-error">{error}</p>}
          <div className="row">
            <Button type="submit" variant="primary" disabled={fetcher.state !== "idle"}>{fetcher.state !== "idle" ? "One moment…" : "Accept and continue to payment"}</Button>
          </div>
        </fetcher.Form>
      )}
      {open && (
        <fetcher.Form method="post" className="stack" aria-label="Decline this quote">
          <CsrfField /><input type="hidden" name="intent" value="decline" />
          <div><Button type="submit" variant="secondary" disabled={fetcher.state !== "idle"}>Decline this quote</Button></div>
        </fetcher.Form>
      )}
      {quote.bookingId && <p><Link to={`/bookings/${encodeURIComponent(quote.bookingId)}`}>Go to your booking</Link></p>}
      <p><Link to="/account/quotes">All your quote requests</Link></p>
    </div>
  );
}
