import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { CsrfField } from "./Shell";
import { formatMoney } from "./ui/display";
import { Button, Input, Select } from "./ui/form";
import { apiLocation, groupSlotsByDay, newHoldKey, safeZone, type Availability, type WidgetLocation } from "~/lib/bookings";

/**
 * THE BOOKING SLOT: the one component boundary the services/bookings workstream (M4) fills on a service page (/p/:slug for a listing of type `service`).
 *
 * Contract. The page renders `<BookingSlot {...props} />` for a service (never for a product). The props below are everything the page knows. `variantId` is the option the
 * visitor chose (a variant of `listingId`; a service with no options has one synthetic option whose id is the listing id). `locations` are the places the seller offers it, from the
 * seller's own settings: `online`, `at-home` (the provider comes to the customer) and `at-seller` (the customer goes to the provider); empty when the seller set none. `available` is
 * false when the chosen option cannot be booked now. Public data only: the page has no visitor data, so anything personal (address, postal code, phone) is asked by the widget itself.
 *
 * What it does (decision M4W-01): asks the BFF for the times (`/services/:id/availability`, the API's cache applies), shows them by day in the provider's time zone, and posts the
 * chosen time to `/bookings/holds`. A signed-in buyer lands on the booking page (hold, details, payment); a visitor is sent to sign in and back to this page. Nothing is held until the
 * buyer presses the button, and the price shown is display only (the booking is priced by the server).
 */
export interface BookingSlotProps {
  listingId: string;
  variantId: string;
  /** Names for headings and accessible labels. */
  title: string;
  variantName: string;
  /** Whole cents and currency of the chosen option (display only: the booking re-prices on the server). */
  priceCents: number;
  currency: string;
  locations: ServiceLocation[];
  /** From the seller: how bookings are accepted (`instant` or `request`), and how long one lasts, as text ("90 min"). Either can be missing. */
  bookingMode?: string | undefined;
  durationLabel?: string | undefined;
  available: boolean;
}
export type ServiceLocation = WidgetLocation;
export const SERVICE_LOCATION_LABELS: Record<ServiceLocation, string> = { online: "Online", "at-home": "At your home", "at-seller": "At the provider" };

/** What the widget says for each short code the BFF or the API gives. Anything else is "try again". */
export const AVAILABILITY_MESSAGES: Record<string, string> = {
  outside_service_area: "The provider does not come to that postal code.",
  location_not_offered: "The provider does not offer this service there.",
  validation_failed: "Please check the postal code and try again.",
  availability_unavailable: "We could not load the times just now. Please try again in a moment.",
};
export const HOLD_MESSAGES: Record<string, string> = {
  slot_taken: "Someone just took that time. Please choose another.",
  too_many_holds: "You are already holding several bookings. Finish or cancel one first.",
  outside_service_area: "The provider does not come to that address.",
  location_not_offered: "The provider does not offer this service there.",
  invalid: "Please check your details and try again.",
  not_found: "This service is no longer available.",
  unavailable: "We could not hold that time just now. Please try again.",
};

/** An answer is only ever shown for the request it belongs to (`key`), so changing the place or postal code never shows the old times and needs no reset. */
type Loaded = { key: string; result: Availability } | { key: string; code: string };

export function BookingSlot(props: BookingSlotProps) {
  if (!props.available) {
    return <div className="add-to-cart" data-testid="booking-slot"><p className="muted">This option cannot be booked right now. Choose another option or check back later.</p></div>;
  }
  if (props.locations.length === 0) {
    return <div className="add-to-cart" data-testid="booking-slot"><p className="muted">The provider has not said where this service takes place yet. Please check back soon.</p></div>;
  }
  return <Widget {...props} />;
}

function Widget({ listingId, title, priceCents, currency, locations, bookingMode, durationLabel }: BookingSlotProps) {
  const fetcher = useFetcher<{ error?: string }>();
  const here = useLocation();
  const [location, setLocation] = useState<ServiceLocation>(locations[0]!);
  const [postal, setPostal] = useState("");
  const [applied, setApplied] = useState("");           // the postal code the times were asked for (at-home only)
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [picked, setPicked] = useState<{ key: string; day: string | null; start: string | null }>({ key: "", day: null, start: null });
  const [key, setKey] = useState(() => newHoldKey());
  const atHome = location === "at-home";
  const needsPostal = atHome && !applied;
  const reqKey = needsPostal ? null : `${location}|${applied}`;
  const current = reqKey !== null && loaded?.key === reqKey ? loaded : null;
  const loading = reqKey !== null && current === null;
  const load = { result: current && "result" in current ? current.result : null, code: current && "code" in current ? current.code : null };
  const day = picked.key === reqKey ? picked.day : null;
  const start = picked.key === reqKey ? picked.start : null;

  useEffect(() => {
    if (reqKey === null) return;
    const ctrl = new AbortController();
    const q = new URLSearchParams({ location: apiLocation(location) });
    if (atHome) q.set("postalCode", applied);
    fetch(`/services/${encodeURIComponent(listingId)}/availability?${q}`, { signal: ctrl.signal, headers: { Accept: "application/json" } })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as Availability & { code?: string };
        setLoaded(r.ok ? { key: reqKey, result: body } : { key: reqKey, code: body.code ?? "availability_unavailable" });
      })
      .catch((e: unknown) => { if (!(e instanceof DOMException && e.name === "AbortError")) setLoaded({ key: reqKey, code: "availability_unavailable" }); });
    return () => ctrl.abort();
  }, [listingId, location, applied, atHome, reqKey]);

  const tz = load.result ? safeZone(load.result.providers[0]?.timeZone) : "UTC";
  const days = useMemo(() => (load.result ? groupSlotsByDay(load.result.slots, tz) : []), [load.result, tz]);
  const shownDay = days.find((d) => d.key === day) ?? null;
  const chosen = load.result ? load.result.slots.find((s) => s.startAt === start) : undefined;
  const price = load.result ? load.result.priceCents : priceCents;
  const submitting = fetcher.state !== "idle";
  const holdError = fetcher.data?.error ? (HOLD_MESSAGES[fetcher.data.error] ?? HOLD_MESSAGES["unavailable"]!) : null;

  return (
    <div className="add-to-cart stack" data-testid="booking-slot">
      {locations.length > 1 && (
        <Select label="Where" name="where" value={location} onChange={(e) => { setLocation(e.target.value as ServiceLocation); setApplied(""); setPostal(""); }}>
          {locations.map((l) => <option key={l} value={l}>{SERVICE_LOCATION_LABELS[l]}</option>)}
        </Select>
      )}
      {atHome && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); setApplied(postal.trim()); }} aria-label="Check your area">
          <Input label="Your postal code" name="postal" value={postal} onChange={(e) => setPostal(e.target.value)} autoComplete="postal-code" maxLength={20} required />
          <Button type="submit" variant="secondary">Show times</Button>
        </form>
      )}
      {loading && <p className="muted" role="status">Finding times…</p>}
      {load.code && <p role="alert" data-testid="availability-error">{AVAILABILITY_MESSAGES[load.code] ?? AVAILABILITY_MESSAGES["availability_unavailable"]}</p>}
      {load.result && days.length === 0 && <p className="muted" data-testid="no-times">No times are open in the next two weeks. Please check back soon.</p>}
      {load.result && days.length > 0 && (
        <>
          <p className="muted" style={{ margin: 0 }}>Times are shown in {tz.replace(/_/g, " ")}{durationLabel ? ` · ${durationLabel}` : ""}.</p>
          <div role="group" aria-label="Choose a day" className="row" style={{ flexWrap: "wrap" }}>
            {days.map((d) => (
              <Button key={d.key} variant={d.key === shownDay?.key ? "primary" : "secondary"} aria-pressed={d.key === shownDay?.key} onClick={() => setPicked({ key: reqKey ?? "", day: d.key, start: null })}>{d.label}</Button>
            ))}
          </div>
          {shownDay && (
            <div role="group" aria-label={`Times on ${shownDay.label}`} className="row" style={{ flexWrap: "wrap" }}>
              {shownDay.slots.map((s) => (
                <Button key={s.startAt} variant={s.startAt === start ? "primary" : "secondary"} aria-pressed={s.startAt === start} onClick={() => { setPicked({ key: reqKey ?? "", day, start: s.startAt }); setKey(newHoldKey()); }}>{s.label}</Button>
              ))}
            </div>
          )}
        </>
      )}
      {chosen && (
        <fetcher.Form method="post" action="/bookings/holds" className="stack" aria-label={`Book ${title}`}>
          <CsrfField />
          <input type="hidden" name="listingId" value={listingId} />
          <input type="hidden" name="start" value={chosen.startAt} />
          <input type="hidden" name="location" value={apiLocation(location)} />
          <input type="hidden" name="durationMinutes" value={load.result ? load.result.durationMinutes : ""} />
          <input type="hidden" name="key" value={key} />
          <input type="hidden" name="returnTo" value={here.pathname + here.search} />
          {atHome && (
            <fieldset className="stack">
              <legend>Where should they come?</legend>
              <input type="hidden" name="address.postalCode" value={applied} />
              <Input label="Name" name="address.name" autoComplete="name" required maxLength={200} />
              <Input label="Street address" name="address.line1" autoComplete="address-line1" required maxLength={200} />
              <Input label="Apartment, suite (optional)" name="address.line2" autoComplete="address-line2" maxLength={200} />
              <Input label="City" name="address.city" autoComplete="address-level2" required maxLength={100} />
              <Input label="State or region" name="address.region" autoComplete="address-level1" maxLength={100} />
              <Input label="Country (2 letters)" name="address.country" defaultValue="US" autoComplete="country" required maxLength={2} minLength={2} />
            </fieldset>
          )}
          <Button type="submit" variant="primary" disabled={submitting} aria-label={`${bookingMode === "request" ? "Request" : "Hold"} ${title} at the chosen time`}>
            {submitting ? "One moment…" : bookingMode === "request" ? "Request this time" : "Hold this time"} · {formatMoney(price, currency)}
          </Button>
          <p className="muted" style={{ margin: 0 }}>{bookingMode === "request" ? "The provider confirms your request. You pay now and are refunded in full if they decline." : "We hold the time for a few minutes while you pay."} You sign in first if you have not.</p>
          {holdError && <p role="alert" data-testid="hold-error">{holdError}</p>}
        </fetcher.Form>
      )}
    </div>
  );
}
