import type { Route } from "./+types/account.passkeys.options";
import { api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, requireAccount } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { sanitizePasskeyOptions } from "~/lib/passkey.server";
import { bindPasskeyChallenge, hasRecentAuth, sessionCookie } from "~/lib/session.server";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Registration challenge for the signed-in user, bound to this browser session (single use). */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const cfg = getConfig();
  // Adding a sign-in method needs a recent sign-in too (O-11): the page sends the user to confirm their password.
  if (!hasRecentAuth(session, Date.now() / 1000, cfg.reauthWindowSeconds)) {
    return Response.json({ code: "reauth_required", redirectTo: "/account/confirm?next=%2Faccount%2Fpasskeys" }, { status: 403, headers: NO_STORE });
  }
  try {
    const { challengeId, options } = await api.passkeyRegistrationOptions(ctx);
    // Checked per ceremony (registration uses rp.id); the field this ceremony does not use is removed before forwarding.
    const safe = sanitizePasskeyOptions("create", options, cfg.publicOrigin);
    if (!safe) return Response.json({ code: "rp_id_mismatch" }, { status: 502, headers: NO_STORE });
    const bound = bindPasskeyChallenge(session, challengeId, "create", safe.timeout);
    return Response.json({ challengeId, options: safe }, { headers: { ...NO_STORE, "Set-Cookie": sessionCookie(bound, cfg) } });
  } catch (e) {
    return failAccount(e, request);
  }
}

export function loader() {
  throw new Response("Not found", { status: 404 });
}
