import type { Route } from "./+types/account.passkeys.options";
import { api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, requireAccount } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { optionsRpIdOk } from "~/lib/passkey.server";
import { bindPasskeyChallenge, sessionCookie } from "~/lib/session.server";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Registration challenge for the signed-in user, bound to this browser session (single use). */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const cfg = getConfig();
  try {
    const { challengeId, options } = await api.passkeyRegistrationOptions(ctx);
    if (!optionsRpIdOk(options, cfg.publicOrigin)) return Response.json({ code: "rp_id_mismatch" }, { status: 502, headers: NO_STORE });
    const bound = bindPasskeyChallenge(session, challengeId, "create", options.timeout);
    return Response.json({ challengeId, options }, { headers: { ...NO_STORE, "Set-Cookie": sessionCookie(bound, cfg) } });
  } catch (e) {
    return failAccount(e, request);
  }
}

export function loader() {
  throw new Response("Not found", { status: 404 });
}
