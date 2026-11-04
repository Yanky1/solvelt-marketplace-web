import { redirect } from "react-router";
import type { Route } from "./+types/sign-out";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, rotatedCookie } from "~/lib/auth.server";
import { str } from "~/lib/validation";

export function loader() {
  throw redirect("/");
}

/** scope=this signs out this device; scope=all revokes every session of the account. Always clears our cookie. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  let incomplete = false;
  if (session.token) {
    const ctx = apiCtx(request, context, session);
    try {
      await (str(form, "scope") === "all" ? api.signOutAll(ctx) : api.signOut(ctx));
    } catch (e) {
      // A dead token (401) is already signed out. Anything else means the API did not confirm the revocation.
      incomplete = !(e instanceof ApiError && e.status === 401);
    }
  }
  // The local cookie is always cleared (fresh anonymous session id, theme cookie untouched) ...
  const headers = { "Set-Cookie": rotatedCookie(), "Cache-Control": "private, no-store" };
  // ... but the user is told when the server could not confirm the sign-out, instead of silently pretending.
  return redirect(incomplete ? `/sign-in?notice=${str(form, "scope") === "all" ? "signout-all-failed" : "signout-failed"}` : "/", { headers });
}
