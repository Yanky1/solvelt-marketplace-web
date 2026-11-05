/** Booking helpers shared by the widget and the pages (no server code here). API contract: API repo docs/API.md "Services (M4)" and "Bookings". */

export type ApiLocation = "online" | "customer" | "seller";
export type WidgetLocation = "online" | "at-home" | "at-seller";

/** The widget names places the way the seller does; the API names them by who travels. */
export function apiLocation(l: WidgetLocation): ApiLocation {
  return l === "at-home" ? "customer" : l === "at-seller" ? "seller" : "online";
}

export interface SlotView { startAt: string; endAt: string; providerIds: string[] }
export interface Availability {
  durationMinutes: number; priceCents: number; providers: { providerId: string; timeZone: string }[]; slots: SlotView[]; from: string; to: string; fetchedAt: string;
}
export interface DaySlots { key: string; label: string; slots: { startAt: string; endAt: string; label: string; providerIds: string[] }[] }

/** A time zone name the runtime knows, else UTC (the provider's zone comes from the portal: never trusted to be valid). */
export function safeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; }
}

/** Slots grouped by their calendar day in `tz`, in time order; labels are "Tue, Nov 4" and "2:00 PM". */
export function groupSlotsByDay(slots: SlotView[], tz: string | null | undefined, locale = "en-US"): DaySlots[] {
  const zone = safeZone(tz);
  const day = new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "short", month: "short", day: "numeric" });
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const time = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const out: DaySlots[] = [];
  for (const s of [...slots].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))) {
    const d = new Date(s.startAt);
    if (Number.isNaN(d.getTime())) continue;
    const k = key.format(d);
    let g = out.find((x) => x.key === k);
    if (!g) { g = { key: k, label: day.format(d), slots: [] }; out.push(g); }
    g.slots.push({ startAt: s.startAt, endAt: s.endAt, label: time.format(d), providerIds: s.providerIds });
  }
  return out;
}

export interface BookingView {
  id: string; number: string | null; listingId: string; status: string; location: string; startAt: string | null; endAt: string | null; durationMinutes: number | null; currency: string;
  priceCents: number; addOnsCents: number; travelFeeCents: number; totalCents: number; holdExpiresAt: string | null; holdExpired: boolean; approvalDeadline: string | null; proposedStartAt: string | null;
  cancellationFeeCents?: number | null; refundDueCents?: number | null; additionalChargeCents?: number | null; onlineInstructions?: string | null; failureCode?: string | null; createdAt: string;
  requiresBuyerConsent?: boolean; rescheduleRequestedStartAt?: string | null; extraChargeState?: string | null; policy?: PolicyView | null;
}

export type Tone = "good" | "wait" | "bad" | "neutral";
export const BOOKING_STATUS: Record<string, { label: string; text: string; tone: Tone }> = {
  Hold: { label: "Held for you", text: "We are holding this time for you for a few minutes. Pay to confirm it.", tone: "wait" },
  Requested: { label: "Waiting for the provider", text: "The provider has your request and will confirm or suggest another time.", tone: "wait" },
  Confirmed: { label: "Confirmed", text: "Your booking is confirmed.", tone: "good" },
  Rescheduled: { label: "Rescheduled", text: "Your booking was moved to the time shown.", tone: "good" },
  InProgress: { label: "In progress", text: "Your booking is under way.", tone: "good" },
  Completed: { label: "Completed", text: "This booking is done.", tone: "neutral" },
  Declined: { label: "Declined", text: "The provider could not take this booking. Any payment is refunded to your card.", tone: "bad" },
  Expired: { label: "Expired", text: "The hold ran out before the booking was paid. Any payment is refunded to your card.", tone: "bad" },
  CancelledByBuyer: { label: "Cancelled", text: "You cancelled this booking.", tone: "neutral" },
  CancelledBySeller: { label: "Cancelled by the provider", text: "The provider cancelled this booking. Any payment is refunded to your card.", tone: "bad" },
  NoShow: { label: "Missed", text: "This booking was marked as missed.", tone: "bad" },
};
export const bookingStatus = (s: string) => BOOKING_STATUS[s] ?? { label: s, text: "We are updating this booking.", tone: "neutral" as Tone };
/** Statuses that have a time on the calendar (the API's .ics only answers for these). */
export const CALENDAR_STATUSES = new Set(["Requested", "Confirmed", "Rescheduled", "InProgress"]);
/** Statuses in which the buyer can still cancel. */
export const CANCELLABLE = new Set(["Hold", "Requested", "Confirmed", "Rescheduled"]);

export function secondsLeft(expiresAt: string | null | undefined, now: number): number {
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isNaN(t) ? 0 : Math.max(0, Math.ceil((t - now) / 1000));
}
/** "4:05" (minutes:seconds) for a hold's countdown. */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A page path from the query is only ever one of ours: begins with one slash, never "//" or a backslash, never a scheme. */
export function safeReturnPath(p: string | null | undefined, fallback = "/"): string {
  if (!p || !p.startsWith("/") || p.startsWith("//") || p.includes("\\") || [...p].some((ch) => ch.charCodeAt(0) < 32)) return fallback;
  return p;
}

/** Idempotency keys for a hold: 8-100 of `A-Za-z0-9-_.:` (API contract). */
export const newHoldKey = (): string => `hold-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)}`;

/** The badge colours of the UI kit for a booking tone. */
export const badgeTone = (t: Tone): "ok" | "gold" | "err" | "neutral" => (t === "good" ? "ok" : t === "wait" ? "gold" : t === "bad" ? "err" : "neutral");

export interface PolicyView { cancelFreeHours: number | null; cancelFeePercent: number | null; noShowFeePercent: number | null; maxReschedules: number | null; approvalHours: number | null }
export interface AddOn { id: string; name: string; description?: string | null; priceCents: number; extraMinutes: number }
export interface IntakeQuestion { id: string; label: string; kind: "text" | "longText" | "choice" | "yesNo" | "number"; required: boolean; choices?: string[] | null; maxLength?: number | null }
export interface ServiceOptionsView {
  available: boolean; addOns: AddOn[]; intakeQuestions: IntakeQuestion[]; providers: { providerId: string; displayName: string }[]; assignment: string | null; policy: PolicyView | null;
  travelFeeCents?: number | null;
}

/** The cancellation policy in plain words, one short sentence per fact we know; nothing for a fact we do not (never a guess). */
export function policyLines(p: Partial<PolicyView> | null | undefined): string[] {
  if (!p) return [];
  const out: string[] = [];
  const hours = (h: number) => (h % 24 === 0 && h >= 48 ? `${h / 24} days` : h === 1 ? "1 hour" : `${h} hours`);
  if (p.cancelFreeHours != null) {
    out.push(p.cancelFeePercent != null && p.cancelFeePercent > 0
      ? `Free cancellation until ${hours(p.cancelFreeHours)} before the start; after that, ${p.cancelFeePercent}% of the price is kept.`
      : `Free cancellation at any time up to ${hours(p.cancelFreeHours)} before the start.`);
  }
  if (p.noShowFeePercent != null && p.noShowFeePercent > 0) out.push(`If you do not show up, ${p.noShowFeePercent}% of the price is kept.`);
  if (p.maxReschedules != null) out.push(p.maxReschedules === 0 ? "This booking cannot be moved to another time." : `You can change the time up to ${p.maxReschedules} ${p.maxReschedules === 1 ? "time" : "times"}.`);
  return out;
}

/** Add-ons the buyer ticked, by id, limited to ones the service really offers (the page never trusts a stale selection). */
export function pickAddOns(ids: Iterable<string>, offered: AddOn[]): string[] {
  const ok = new Set(offered.map((a) => a.id));
  return [...new Set(ids)].filter((i) => ok.has(i)).sort();
}

export interface QuoteView {
  id: string; listingId: string; status: string; location: string; details: string; preferredTimes?: string[] | null; currency: string; priceCents: number | null; durationMinutes: number | null;
  slots: string[]; providerId?: string | null; expiresAt: string | null; expired: boolean; note: string | null; declineReason: string | null; bookingId: string | null; createdAt: string;
}
export const QUOTE_STATUS: Record<string, { label: string; text: string; tone: Tone }> = {
  Requested: { label: "Waiting for a quote", text: "The provider has your request and will send a price and times.", tone: "wait" },
  Quoted: { label: "Quote received", text: "The provider sent a price. Choose one of the offered times to accept it.", tone: "good" },
  Accepted: { label: "Accepted", text: "You accepted this quote. Your booking is on its page.", tone: "good" },
  Declined: { label: "Declined by the provider", text: "The provider could not quote this job.", tone: "bad" },
  Withdrawn: { label: "Declined", text: "You declined this quote.", tone: "neutral" },
  Expired: { label: "Expired", text: "This quote is no longer valid. You can ask for a new one.", tone: "bad" },
};
export const quoteStatus = (s: string) => QUOTE_STATUS[s] ?? { label: s, text: "We are updating this quote.", tone: "neutral" as Tone };

/** True when the listing's pricing model says the provider quotes each job (the catalog's `pricing-model` attribute; the case the portal uses is not relied on). */
export const isQuoteOnly = (pricingModel: string | undefined): boolean => (pricingModel ?? "").trim().toLowerCase() === "quote";

/** What the buyer sees for an extra amount the provider asked for after the work (the booking's `extraChargeState` and `additionalChargeCents`). */
export const EXTRA_CHARGE_TEXT: Record<string, string> = {
  requested: "The provider asks for an additional amount for this booking.",
  consented: "You agreed to the additional amount. Payment is the last step.",
  declined: "You declined the additional amount.",
  paid: "The additional amount is paid.",
};
