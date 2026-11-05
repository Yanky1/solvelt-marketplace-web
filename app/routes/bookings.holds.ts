import { data, redirect } from "react-router";
import type { Route } from "./+types/bookings.holds";
import { ApiError, api, type HoldBody } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, privateHeaders, signInRedirect } from "~/lib/auth.server";
import { newHoldKey } from "~/lib/bookings";
import { safeNext } from "~/lib/csrf.server";
import { isSafeId } from "~/lib/passkey.server";

export function loader() {
  return redirect("/");
}

const LOCATIONS = new Set(["online", "customer", "seller"]);
const ADDRESS_FIELDS = ["name", "line1", "line2", "city", "region", "postalCode", "country"] as const;

/** A short, fixed set of reasons the widget can explain; the API's own text never reaches the page. */
function holdFailure(e: unknown): string {
  if (!(e instanceof ApiError)) return "unavailable";
  if (e.status === 409) return e.code === "slot_unavailable" ? "slot_taken" : e.code === "too_many_holds" ? "too_many_holds" : "slot_taken";
  if (e.status === 422) return /^(outside_service_area|location_not_offered|duration|add_on|provider_required)$/.test(e.code) ? e.code : "invalid";
  return e.status === 404 ? "not_found" : "unavailable";
}

/** The widget posts here (a fetcher): signed in, it takes the hold and sends the buyer to the booking page; otherwise it answers with a short code. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const returnTo = safeNext(String(form.get("returnTo") ?? ""), "/");
  if (!session.token) {
    // signed out: sign in, then come back to the service page (the buyer picks the time again: nothing is held for a stranger)
    return signInRedirect(new Request(new URL(returnTo, request.url)));
  }
  const listingId = String(form.get("listingId") ?? ""), start = String(form.get("start") ?? ""), location = String(form.get("location") ?? "");
  if (!isSafeId(listingId) || Number.isNaN(Date.parse(start)) || !LOCATIONS.has(location)) throw data("Bad request", { status: 400, headers: privateHeaders });
  const body: HoldBody = { listingId, start: new Date(start).toISOString(), location };
  const duration = Number(form.get("durationMinutes") ?? "");
  if (Number.isInteger(duration) && duration > 0 && duration <= 24 * 60) body.durationMinutes = duration;
  const providerId = String(form.get("providerId") ?? "");
  if (providerId && isSafeId(providerId)) body.providerId = providerId;
  const addOnIds = [...new Set(form.getAll("addOnIds").map(String).filter((id) => /^[A-Za-z0-9._-]{1,100}$/.test(id)))].slice(0, 20);
  if (addOnIds.length) body.addOnIds = addOnIds;
  const phone = String(form.get("phone") ?? "").trim().slice(0, 40);
  if (phone) body.phone = phone;
  if (location === "customer") {
    const address: Record<string, string> = {};
    for (const f of ADDRESS_FIELDS) { const v = String(form.get(`address.${f}`) ?? "").trim().slice(0, 200); if (v) address[f] = v; }
    body.address = address;
  }
  const key = /^[A-Za-z0-9\-_.:]{8,100}$/.test(String(form.get("key") ?? "")) ? String(form.get("key")) : newHoldKey();
  try {
    const { booking } = await api.holdBooking(apiCtx(request, context, session), body, key);
    return redirect(`/bookings/${encodeURIComponent(booking.id)}`, { headers: privateHeaders });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return signInRedirect(new Request(new URL(returnTo, request.url)));
    return data({ error: holdFailure(e) }, { status: e instanceof ApiError && e.status < 500 ? e.status : 503, headers: privateHeaders });
  }
}
