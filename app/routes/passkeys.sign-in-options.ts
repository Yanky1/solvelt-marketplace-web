import type { Route } from "./+types/passkeys.sign-in-options";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { sanitizePasskeyOptions } from "~/lib/passkey.server";
import { bindPasskeyChallenge, sessionCookie } from "~/lib/session.server";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Discoverable-credential challenge for anonymous passkey sign-in, bound to this browser session (single use). */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const cfg = getConfig();
  try {
    const { challengeId, options } = await api.passkeySignInOptions(apiCtx(request, context, null));
    // Checked per ceremony (sign-in uses rpId); the field this ceremony does not use is removed before forwarding.
    const safe = sanitizePasskeyOptions("get", options, cfg.publicOrigin);
    if (!safe) return Response.json({ code: "rp_id_mismatch" }, { status: 502, headers: NO_STORE });
    const bound = bindPasskeyChallenge(session, challengeId, "get", safe.timeout);
    return Response.json({ challengeId, options: safe }, { headers: { ...NO_STORE, "Set-Cookie": sessionCookie(bound, cfg) } });
  } catch (e) {
    const status = e instanceof ApiError && e.status === 429 ? 429 : 503;
    return Response.json({ code: status === 429 ? "rate_limited" : "unavailable" }, { status, headers: NO_STORE });
  }
}

export function loader() {
  throw new Response("Not found", { status: 404 });
}
