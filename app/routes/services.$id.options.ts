import { data } from "react-router";
import type { Route } from "./+types/services.$id.options";
import { api } from "~/lib/api-client.server";
import { apiCtx } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";

/**
 * What the widget needs besides times: add-ons, who can be chosen, the cancellation policy (public data, cacheable: always read WITHOUT the visitor's session, so the answer can never differ by who asks). A service whose options cannot be read answers
 * `available: false` with no extras, so the widget still offers plain times; the API's own text never reaches the browser.
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  if (!isSafeId(params.id)) throw data("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const o = await api.serviceOptions(apiCtx(request, context, null), params.id);
    return data({ available: o.available, addOns: o.addOns, intakeQuestions: o.intakeQuestions, providers: o.providers.map((p) => ({ providerId: p.providerId, displayName: p.displayName })), assignment: o.assignment ?? null, policy: o.policy ?? null, travelFeeCents: o.travelFeeCents ?? null }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch {
    return data({ available: false, addOns: [], intakeQuestions: [], providers: [], assignment: null, policy: null }, { headers: { "Cache-Control": "no-store" } });
  }
}
