import { useState } from "react";
import { redirect, useActionData, useNavigation, useSearchParams, useSubmit } from "react-router";
import type { Route } from "./+types/staff.sign-in";
import { FormMessage } from "~/components/AuthForm";
import { useStaffLayout } from "~/components/StaffUi";
import { Card } from "~/components/ui/display";
import { Button } from "~/components/ui/form";
import { ApiError } from "~/lib/api-client.server";
import { getConfig } from "~/lib/config.server";
import { checkPasskeyChallenge } from "~/lib/session.server";
import { assertStaffCsrf, signedInCookie, staffCtx, staffForm, staffHeaders } from "~/lib/staff-auth.server";
import { staffApi } from "~/lib/staff-api.server";
import { readStaffSession, safeStaffNext } from "~/lib/staff-session.server";
import { getPasskey, usePasskeysSupported } from "~/lib/webauthn";

export function meta() {
  return [{ title: "Staff sign-in | Solvelt" }, { name: "robots", content: "noindex, nofollow" }];
}
export function headers() {
  return staffHeaders;
}

export function loader({ request }: Route.LoaderArgs) {
  if (readStaffSession(request, getConfig())?.token) throw redirect("/staff", { headers: staffHeaders });
  return null;
}

/** Passkey only: there is no password, no reset mail and no "remember me". Every failure is the same sentence. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertStaffCsrf(request, form);
  const failed = () => staffForm({ message: "That passkey was not accepted. Try again, or ask an admin for a new enrolment link." }, 401);
  const challengeId = String(form.get("challengeId") ?? "");
  if (!checkPasskeyChallenge(session, challengeId, "get").ok) return staffForm({ message: "That sign-in request expired. Please try again." }, 400);
  let credential: unknown;
  try { credential = JSON.parse(String(form.get("credential") ?? "")); } catch { return failed(); }
  try {
    const { token } = await staffApi.signIn(staffCtx(request, context, session), challengeId, credential);
    return redirect(safeStaffNext(form.get("next")), { headers: { ...staffHeaders, "Set-Cookie": signedInCookie(token) } });
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) return staffForm({ message: "Too many attempts. Wait a minute and try again." }, 429);
    if (e instanceof ApiError && e.status < 500) return failed();
    return staffForm({ message: "The service is temporarily unavailable. Please try again." }, 503);
  }
}

export default function StaffSignIn() {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const submit = useSubmit();
  const csrf = useStaffLayout().csrf;
  const [params] = useSearchParams();
  const supported = usePasskeysSupported();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function signIn() {
    setError(null); setWorking(true);
    try {
      const res = await fetch("/staff/passkey/sign-in", { method: "POST", body: new URLSearchParams({ csrf }), credentials: "same-origin" });
      if (!res.ok) throw new Error("options");
      const { challengeId, options } = (await res.json()) as { challengeId: string; options: Record<string, unknown> };
      const credential = await getPasskey(options);
      const fd = new FormData();
      fd.set("csrf", csrf); fd.set("challengeId", challengeId); fd.set("credential", JSON.stringify(credential)); fd.set("next", params.get("next") ?? "");
      submit(fd, { method: "post" });
    } catch (e) {
      const cancelled = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");
      setError(cancelled ? "Sign-in was cancelled." : "We could not start the passkey sign-in. Please try again.");
    } finally { setWorking(false); }
  }

  return (
    <Card className="stack" style={{ maxWidth: 480 }}>
      <h2>Sign in</h2>
      <p className="muted">Staff sign in with a passkey. First time? Use the one-time link an admin gave you: <a href="/staff/enrol">enrol a passkey</a>.</p>
      {supported === false && <FormMessage kind="error">This browser or device does not support passkeys.</FormMessage>}
      {(error || a?.message) && <FormMessage kind="error">{error ?? a?.message}</FormMessage>}
      <Button onClick={signIn} disabled={!supported || working || busy}>{working ? "Waiting for your device…" : "Sign in with a passkey"}</Button>
    </Card>
  );
}
