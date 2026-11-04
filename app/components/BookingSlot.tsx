import { CsrfField } from "./Shell";
import { Button } from "./ui/form";

/**
 * THE BOOKING SLOT: the one component boundary the services/bookings workstream (M4) fills on a service page (/p/:slug for a listing of type `service`).
 *
 * Contract. The page renders `<BookingSlot {...props} />` for a service (never for a product). M4 replaces the BODY of this component (this file only) with the
 * real widget: availability for the chosen option, a slot picker, and the booking or quote request. Nothing else on the page changes, and the props below are
 * everything the page knows. `variantId` is the option the visitor chose (a variant of `listingId`; a service with no options has one synthetic option whose id
 * is the listing id: the API marks it `isDefault`, so a request for it names the service only). `locations` are the places the seller offers it, from the
 * seller's own settings: `online`, `at-home` (the provider comes to the customer) and `at-seller` (the customer goes to the provider); empty when the seller
 * set none. `available` is false when the chosen option cannot be booked now (the slot then shows why and offers nothing). Public data only: the page has no
 * visitor data, so anything personal (address, postal code, name) is asked by the widget itself, never passed in.
 * Until the booking action exists the slot is a disabled button with a plain explanation, so a visitor is never offered a form that goes nowhere.
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
export type ServiceLocation = "online" | "at-home" | "at-seller";
export const SERVICE_LOCATION_LABELS: Record<ServiceLocation, string> = { online: "Online", "at-home": "At your home", "at-seller": "At the provider" };

/** Flip to true (and set `action`) when the booking action lands. */
export const BOOKING_ACTION: { ready: boolean; action: string } = { ready: false, action: "/bookings/requests" };

export function BookingSlot({ listingId, variantId, title, variantName, locations, available }: BookingSlotProps) {
  if (!available) {
    return <div className="add-to-cart" data-testid="booking-slot"><p className="muted">This option cannot be booked right now. {`Choose another option or check back later.`}</p></div>;
  }
  if (!BOOKING_ACTION.ready) {
    return (
      <div className="add-to-cart" data-testid="booking-slot">
        <Button type="button" variant="primary" disabled aria-describedby="booking-soon">Request a booking</Button>
        <p id="booking-soon" className="muted">Online booking opens soon.</p>
      </div>
    );
  }
  return (
    <form method="post" action={BOOKING_ACTION.action} className="add-to-cart stack" data-testid="booking-slot">
      <CsrfField />
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="variantId" value={variantId} />
      {locations.length > 1 && (
        <label className="row">Where
          <select name="location" className="select">{locations.map((l) => <option key={l} value={l}>{SERVICE_LOCATION_LABELS[l]}</option>)}</select>
        </label>
      )}
      <Button type="submit" variant="primary" aria-label={`Request a booking for ${title}, ${variantName}`}>Request a booking</Button>
    </form>
  );
}
