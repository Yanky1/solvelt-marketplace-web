import { useState } from "react";
import { redirect, useActionData, useNavigation, useSearchParams, useSubmit } from "react-router";
import type { Route } from "./+types/staff.confirm";
import { FormMessage } from "~/components/AuthForm";
import { useStaffLayout } from "~/components/StaffUi";
import { Card } from "~/components/ui/display";
import { Button } from "~/components/ui/form";
import { ApiError } from "~/lib/api-client.server";
import { getConfig } from "~/lib/config.server";
import { checkPasskeyChallenge, withoutPasskeyChallenge } from "~/lib/session.server";
import { assertStaffCsrf, failStaff, requireStaff, staffCtx, staffForm, staffHeaders } from "~/lib/staff-auth.server";
import { staffApi } from "~/lib/staff-api.server";
import { safeStaffNext, staffCookie } from "~/lib/staff-session.server";
import { getPasskey, usePasskeysSupported } from "~/lib/webauthn";

export function meta() {
  return [{ title: "Confirm it is you | Solvelt staff" }, { name: "robots", content: "noindex, nofollow" }];
}
export function headers() {
  return staffHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireStaff(request, context);
  return null;
}

/** The step-up (decision M7-02): a fresh passkey check, then back to what the person was doing. The API decides how long it counts. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertStaffCsrf(request, form);
  const cfg = getConfig();
  const challengeId = String(form.get("challengeId") ?? "");
  const drop = { "Set-Cookie": staffCookie(withoutPasskeyChallenge(session), cfg) };
  if (!checkPasskeyChallenge(session, challengeId, "get").ok) return staffForm({ message: "That request expired. Please try again." }, 400, drop);
  let credential: unknown;
  try { credential = JSON.parse(String(form.get("credential") ?? "")); } catch { return staffForm({ message: "That passkey could not be read." }, 400, drop); }
  try {
    await staffApi.reauth(staffCtx(request, context, session), challengeId, credential);
    return redirect(safeStaffNext(form.get("next")), { headers: { ...staffHeaders, "Set-Cookie": staffCookie({ ...withoutPasskeyChallenge(session), authAt: Math.floor(Date.now() / 1000) }, cfg) } });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 400 || e.status === 403)) return staffForm({ message: "That passkey was not accepted." }, 400, drop);
    return failStaff(e, request, drop);
  }
}

export default function StaffConfirm() {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const submit = useSubmit();
  const csrf = useStaffLayout().csrf;
  const [params] = useSearchParams();
  const supported = usePasskeysSupported();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function confirm() {
    setError(null); setWorking(true);
    try {
      const res = await fetch("/staff/passkey/reauth", { method: "POST", body: new URLSearchParams({ csrf }), credentials: "same-origin" });
      if (!res.ok) throw new Error("options");
      const { challengeId, options } = (await res.json()) as { challengeId: string; options: Record<string, unknown> };
      const credential = await getPasskey(options);
      const fd = new FormData();
      fd.set("csrf", csrf); fd.set("challengeId", challengeId); fd.set("credential", JSON.stringify(credential)); fd.set("next", params.get("next") ?? "");
      submit(fd, { method: "post" });
    } catch (e) {
      const cancelled = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");
      setError(cancelled ? "Cancelled." : "We could not start the passkey check. Please try again.");
    } finally { setWorking(false); }
  }

  return (
    <Card className="stack u-max-width-480px">
      <h2>Confirm it is you</h2>
      <p className="muted">This action needs a fresh passkey check. Afterwards you are taken back and can do it again.</p>
      {supported === false && <FormMessage kind="error">This browser or device does not support passkeys.</FormMessage>}
      {(error || a?.message) && <FormMessage kind="error">{error ?? a?.message}</FormMessage>}
      <Button onClick={confirm} disabled={!supported || working || busy}>{working ? "Waiting for your device…" : "Confirm with my passkey"}</Button>
    </Card>
  );
}
