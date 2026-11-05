import type { Route } from "./+types/staff.passkey";
import { ApiError } from "~/lib/api-client.server";
import { getConfig } from "~/lib/config.server";
import { sanitizePasskeyOptions } from "~/lib/passkey.server";
import { bindPasskeyChallenge } from "~/lib/session.server";
import { assertStaffCsrf, staffCtx, staffHeaders } from "~/lib/staff-auth.server";
import { staffApi, type StaffPasskeyChallenge } from "~/lib/staff-api.server";
import { staffCookie } from "~/lib/staff-session.server";

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...staffHeaders, ...extra } });

/**
 * The browser asks for WebAuthn options here (a JSON endpoint, like the buyer's): `sign-in` (anonymous), `enrol` (with the one-time link) and `reauth` (a signed-in member proving themselves again).
 * The API's challenge is bound to THIS browser's staff cookie and works once, so another browser cannot complete it. Options whose relying-party id is not our own host are refused.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertStaffCsrf(request, form);
  const cfg = getConfig();
  const ctx = staffCtx(request, context, session);
  try {
    let challenge: StaffPasskeyChallenge;
    let kind: "create" | "get";
    if (params.step === "sign-in") { challenge = await staffApi.signInOptions(ctx); kind = "get"; }
    else if (params.step === "enrol") {
      const token = String(form.get("token") ?? "").trim();
      if (!token || token.length > 200) return json({ code: "invalid_token" }, 400);
      challenge = await staffApi.enrolOptions(ctx, token); kind = "create";
    } else if (params.step === "reauth") {
      if (!session.token) return json({ code: "unauthorized" }, 401);
      challenge = await staffApi.reauthOptions(ctx); kind = "get";
    } else return json({ code: "not_found" }, 404);
    const safe = sanitizePasskeyOptions(kind, challenge.options, cfg.publicOrigin);
    if (!safe) return json({ code: "rp_id_mismatch" }, 502);
    const bound = bindPasskeyChallenge(session, challenge.challengeId, kind, safe.timeout);
    return json({ challengeId: challenge.challengeId, options: safe }, 200, { "Set-Cookie": staffCookie(bound, cfg) });
  } catch (e) {
    if (e instanceof ApiError) return json({ code: e.code }, e.status === 400 || e.status === 401 || e.status === 403 || e.status === 409 || e.status === 429 ? e.status : 503);
    throw e;
  }
}

export function loader() {
  throw new Response("Not found", { status: 404, headers: staffHeaders });
}
