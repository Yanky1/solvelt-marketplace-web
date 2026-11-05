import { redirect } from "react-router";
import type { Route } from "./+types/account.privacy.export";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { hasRecentAuth } from "~/lib/session.server";

const CONFIRM = "/account/confirm?next=%2Faccount%2Fprivacy";

export function loader() {
  throw redirect("/account/privacy");   // a file is only ever made by a POST (a link or a prefetcher cannot start it)
}

/**
 * "Download my data": the API builds one JSON file of the buyer's own data (API decision M5-32) and this route hands it to the browser as a download. It is a plain form POST (works without
 * JavaScript), checked for CSRF, and needs a recent sign-in (else the person confirms their password first, then comes back). Nothing is kept here: the body is streamed through.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  if (!hasRecentAuth(session, Date.now() / 1000, getConfig().reauthWindowSeconds)) return redirect(CONFIRM, { headers: privateHeaders });
  try {
    const res = await api.dataExport(ctx);
    if (res.status === 403) return redirect(CONFIRM, { headers: privateHeaders });
    if (res.status === 401) throw new ApiError(401, "unauthorized", "Sign in required");
    if (!res.ok) return redirect("/account/privacy?export=failed", { status: 303, headers: privateHeaders });
    return new Response(res.body, {
      status: 200,
      headers: { ...privateHeaders, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="solvelt-my-data.json"', "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return failAccount(e, request);
  }
}
