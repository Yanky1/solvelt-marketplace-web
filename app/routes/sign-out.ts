import { redirect } from "react-router";
import type { Route } from "./+types/sign-out";
import { api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, rotatedCookie } from "~/lib/auth.server";
import { str } from "~/lib/validation";

export function loader() {
  throw redirect("/");
}

/** scope=this signs out this device; scope=all revokes every session of the account. Always clears our cookie. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  if (session.token) {
    const ctx = apiCtx(request, context, session);
    try {
      await (str(form, "scope") === "all" ? api.signOutAll(ctx) : api.signOut(ctx));
    } catch {
      // The API may be down or the token already dead: the local session is cleared regardless.
    }
  }
  // Fresh anonymous session id: the old token is dropped from the cookie, the theme cookie is untouched.
  return redirect("/", { headers: { "Set-Cookie": rotatedCookie(), "Cache-Control": "private, no-store" } });
}
