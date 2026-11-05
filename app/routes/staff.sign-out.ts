import { redirect } from "react-router";
import type { Route } from "./+types/staff.sign-out";
import { getConfig } from "~/lib/config.server";
import { assertStaffCsrf, staffCtx, staffHeaders } from "~/lib/staff-auth.server";
import { staffApi } from "~/lib/staff-api.server";
import { clearStaffCookie } from "~/lib/staff-session.server";

/** Ends the session at the API (best effort: the cookie goes either way) and clears the cookie. */
export async function action({ request, context }: Route.ActionArgs) {
  const session = assertStaffCsrf(request, await request.formData());
  try { await staffApi.signOut(staffCtx(request, context, session)); } catch { /* already dead or the API is down: the cookie is cleared anyway */ }
  return redirect("/staff/sign-in", { headers: { ...staffHeaders, "Set-Cookie": clearStaffCookie(getConfig()) } });
}

export function loader() {
  throw new Response("Not found", { status: 404, headers: staffHeaders });
}
