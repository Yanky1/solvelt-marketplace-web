import { Form, useActionData, useFetcher, useNavigation } from "react-router";
import type { Route } from "./+types/staff.accounts";
import { ReasonField, StaffCsrf, when } from "~/components/StaffUi";
import { FormMessage } from "~/components/AuthForm";
import { Badge, Card } from "~/components/ui/display";
import { Button, Input, Select } from "~/components/ui/form";
import { getConfig } from "~/lib/config.server";
import { apiMessage, assertStaffCsrf, failStaff, requirePermission, requireStaff, staffForm, staffHeaders } from "~/lib/staff-auth.server";
import { staffApi } from "~/lib/staff-api.server";

export function meta() {
  return [{ title: "Staff accounts | Solvelt staff" }, { name: "robots", content: "noindex, nofollow" }];
}
export function headers() {
  return staffHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx, me } = await requireStaff(request, context);
  requirePermission(me, "staff.manage");
  try { return { accounts: await staffApi.accounts(ctx), meId: me.id }; } catch (e) { return failStaff(e, request); }
}

type Result = { kind: "link"; link: string; expiresAt: string } | { kind: "done"; message: string } | { kind: "error"; message: string };
const text = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

/** An enrolment link is shown ONCE, in this response only (never stored), with the secret after `#` so it never reaches a server log. */
const linkFor = (token: string) => `${getConfig().publicOrigin}/staff/enrol#${encodeURIComponent(token)}`;

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertStaffCsrf(request, form);
  const { ctx, me } = await requireStaff(request, context);
  requirePermission(me, "staff.manage");
  const intent = text(form, "intent"), reason = text(form, "reason"), id = text(form, "id");
  try {
    switch (intent) {
      case "create": { const r = await staffApi.createAccount(ctx, { email: text(form, "email"), displayName: text(form, "displayName"), role: text(form, "role"), reason }); return staffForm<Result>({ kind: "link", link: linkFor(r.enrolmentToken), expiresAt: r.expiresAt }); }
      case "reissue": { const r = await staffApi.reissue(ctx, id, form.get("revoke") === "on", reason); return staffForm<Result>({ kind: "link", link: linkFor(r.enrolmentToken), expiresAt: r.expiresAt }); }
      case "role": await staffApi.setRole(ctx, id, text(form, "role"), reason); return staffForm<Result>({ kind: "done", message: "Role changed. Their sessions ended." });
      case "disable": case "enable": await staffApi.setDisabled(ctx, id, intent === "disable", reason); return staffForm<Result>({ kind: "done", message: intent === "disable" ? "Disabled." : "Enabled." });
      case "signout": await staffApi.signOutStaff(ctx, id, reason); return staffForm<Result>({ kind: "done", message: "Every session ended." });
      default: throw new Response("Bad request", { status: 400, headers: staffHeaders });
    }
  } catch (e) {
    if (e instanceof Response) throw e;
    const m = apiMessage(e);
    if (m) return staffForm<Result>({ kind: "error", message: m }, 400);
    return failStaff(e, request);
  }
}

function LinkBox({ link, expiresAt }: { link: string; expiresAt: string }) {
  return (
    <div role="status" className="stack" data-testid="enrol-link">
      <FormMessage kind="ok">Give this one-time link to the staff member. It is shown only now and expires {when(expiresAt)}.</FormMessage>
      <code style={{ wordBreak: "break-all" }}>{link}</code>
    </div>
  );
}

function Row({ a, meId }: { a: Route.ComponentProps["loaderData"]["accounts"][number]; meId: string }) {
  const f = useFetcher<Result>();
  return (
    <Card className="stack">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div><strong>{a.displayName}</strong> <span className="muted">{a.email}</span>{a.id === meId ? " (you)" : ""}</div>
        <div className="row"><Badge tone="gold">{a.role}</Badge>{!a.enrolled && <Badge>Not enrolled</Badge>}{a.disabled && <Badge tone="err">Disabled</Badge>}</div>
      </div>
      <div className="muted">{a.passkeys} passkey(s) · last sign-in {when(a.lastSignInAt)}</div>
      {f.data?.kind === "link" && <LinkBox link={f.data.link} expiresAt={f.data.expiresAt} />}
      {f.data?.kind === "done" && <FormMessage kind="ok">{f.data.message}</FormMessage>}
      {f.data?.kind === "error" && <FormMessage kind="error">{f.data.message}</FormMessage>}
      <details><summary>Manage…</summary>
        <f.Form method="post" className="stack">
          <StaffCsrf /><input type="hidden" name="id" value={a.id} />
          <ReasonField id={`reason-${a.id}`} />
          <Select label="Role" name="role" defaultValue={a.role}><option value="support">support</option><option value="finance">finance</option><option value="admin">admin</option></Select>
          <label className="row"><input type="checkbox" name="revoke" /> Lost device: also remove their passkeys and end their sessions (with "New enrolment link")</label>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Button type="submit" name="intent" value="role" variant="secondary" disabled={f.state !== "idle"}>Change role</Button>
            <Button type="submit" name="intent" value="reissue" variant="secondary" disabled={f.state !== "idle"}>New enrolment link</Button>
            <Button type="submit" name="intent" value="signout" variant="secondary" disabled={f.state !== "idle"}>Sign out everywhere</Button>
            <Button type="submit" name="intent" value={a.disabled ? "enable" : "disable"} variant={a.disabled ? "secondary" : "primary"} disabled={f.state !== "idle"}>{a.disabled ? "Enable" : "Disable"}</Button>
          </div>
        </f.Form>
      </details>
    </Card>
  );
}

export default function StaffAccounts({ loaderData }: Route.ComponentProps) {
  const a = useActionData<typeof action>() as Result | undefined;
  const busy = useNavigation().state !== "idle";
  return (
    <div className="stack">
      <h2>Staff accounts</h2>
      <Card className="stack">
        <h3>Add a staff member</h3>
        <Form method="post" className="stack">
          <StaffCsrf /><input type="hidden" name="intent" value="create" />
          <Input label="Email" name="email" type="email" required maxLength={254} autoComplete="off" />
          <Input label="Name" name="displayName" required maxLength={60} autoComplete="off" />
          <Select label="Role" name="role" defaultValue="support"><option value="support">support</option><option value="finance">finance</option><option value="admin">admin</option></Select>
          <ReasonField id="reason-create" />
          <Button type="submit" disabled={busy}>Create and get the link</Button>
        </Form>
        {a?.kind === "link" && <LinkBox link={a.link} expiresAt={a.expiresAt} />}
        {a?.kind === "error" && <FormMessage kind="error">{a.message}</FormMessage>}
      </Card>
      {loaderData.accounts.map((x) => <Row key={x.id} a={x} meId={loaderData.meId} />)}
    </div>
  );
}
