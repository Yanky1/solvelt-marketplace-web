import { Form, Outlet } from "react-router";
import type { Route } from "./+types/staff";
import { StaffNav, StaffCsrf } from "~/components/StaffUi";
import { Badge } from "~/components/ui/display";
import { Button } from "~/components/ui/form";
import { ApiError } from "~/lib/api-client.server";
import { getConfig } from "~/lib/config.server";
import { ensureStaffVisitor, staffCtx, staffHeaders } from "~/lib/staff-auth.server";
import { staffApi, type StaffMe } from "~/lib/staff-api.server";
import { data } from "react-router";

export function meta() {
  return [{ title: "Staff | Solvelt" }, { name: "robots", content: "noindex, nofollow" }];
}
export function headers() {
  return staffHeaders;
}

/** The staff layout: the staff CSRF token and, when signed in, who this is. It never redirects (sign-in and enrolment live under it); each page asks for the staff member itself. */
export async function loader({ request, context }: Route.LoaderArgs) {
  void getConfig;
  const visitor = ensureStaffVisitor(request);
  let me: StaffMe | null = null;
  if (visitor.session.token) {
    try { me = await staffApi.me(staffCtx(request, context, visitor.session)); }
    catch (e) { if (!(e instanceof ApiError)) throw e; }   // a dead token shows as signed out; the page that needs a session redirects
  }
  return data({ csrf: visitor.csrf, me }, { headers: { ...staffHeaders, ...(visitor.setCookie ? { "Set-Cookie": visitor.setCookie } : {}) } });
}

export default function Staff({ loaderData }: Route.ComponentProps) {
  const me = loaderData.me;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h1>Staff</h1>
        {me && (
          <div className="row">
            <span className="muted">{me.displayName} <Badge tone="gold">{me.role}</Badge></span>
            <Form method="post" action="/staff/sign-out"><StaffCsrf /><Button type="submit" variant="secondary">Sign out</Button></Form>
          </div>
        )}
      </div>
      {me && <StaffNav me={me} />}
      <Outlet />
    </div>
  );
}
