import { data, redirect } from "react-router";
import type { Route } from "./+types/quotes.new";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, privateHeaders, signInRedirect } from "~/lib/auth.server";
import { newHoldKey } from "~/lib/bookings";
import { safeNext } from "~/lib/csrf.server";
import { isSafeId } from "~/lib/passkey.server";

export function loader() {
  return redirect("/");
}

const LOCATIONS = new Set(["online", "customer", "seller"]);
const ADDRESS_FIELDS = ["name", "line1", "line2", "city", "region", "postalCode", "country"] as const;

/** Short, fixed reasons the form can explain; the API's own text never reaches the page. */
function quoteFailure(e: unknown): string {
  if (!(e instanceof ApiError)) return "unavailable";
  if (e.status === 422) return e.code === "outside_service_area" ? "outside_service_area" : e.code === "too_many_quotes" ? "too_many_quotes" : "invalid";
  if (e.status === 409) return "conflict";
  return e.status === 404 ? "not_found" : "unavailable";
}

/** The "request a quote" form of a service the provider prices per job posts here (a fetcher): signed in, it sends the request and opens the quote page. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const returnTo = safeNext(String(form.get("returnTo") ?? ""), "/");
  if (!session.token) return signInRedirect(new Request(new URL(returnTo, request.url)));
  const listingId = String(form.get("listingId") ?? ""), location = String(form.get("location") ?? ""), details = String(form.get("details") ?? "").trim();
  if (!isSafeId(listingId) || !LOCATIONS.has(location)) throw data("Bad request", { status: 400, headers: privateHeaders });
  if (details.length < 10 || details.length > 2000) return data({ error: "details" }, { status: 422, headers: privateHeaders });
  const body: Record<string, unknown> = { listingId, location, details };
  const phone = String(form.get("phone") ?? "").trim().slice(0, 40);
  if (phone) body["phone"] = phone;
  if (location === "customer") {
    const address: Record<string, string> = {};
    for (const f of ADDRESS_FIELDS) { const v = String(form.get(`address.${f}`) ?? "").trim().slice(0, 200); if (v) address[f] = v; }
    body["address"] = address;
  }
  const key = /^[A-Za-z0-9\-_.:]{8,100}$/.test(String(form.get("key") ?? "")) ? String(form.get("key")) : newHoldKey();
  try {
    const r = await api.requestQuote(apiCtx(request, context, session), body, key);
    return redirect(`/quotes/${encodeURIComponent(r.quote.id)}`, { headers: privateHeaders });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return signInRedirect(new Request(new URL(returnTo, request.url)));
    return data({ error: quoteFailure(e) }, { status: e instanceof ApiError && e.status < 500 ? e.status : 503, headers: privateHeaders });
  }
}
