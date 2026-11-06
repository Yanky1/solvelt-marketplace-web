import { useEffect, useState } from "react";
import { redirect, useActionData, useNavigation, useSubmit } from "react-router";
import type { Route } from "./+types/staff.enrol";
import { FormMessage } from "~/components/AuthForm";
import { useStaffLayout } from "~/components/StaffUi";
import { Card } from "~/components/ui/display";
import { Button, Input } from "~/components/ui/form";
import { ApiError } from "~/lib/api-client.server";
import { checkPasskeyChallenge } from "~/lib/session.server";
import { assertStaffCsrf, signedInCookie, staffCtx, staffForm, staffHeaders } from "~/lib/staff-auth.server";
import { staffApi } from "~/lib/staff-api.server";
import { tokenFromHash } from "~/lib/staff-enrol";
import { createPasskey, usePasskeysSupported } from "~/lib/webauthn";

export function meta() {
  return [{ title: "Enrol a passkey | Solvelt staff" }, { name: "robots", content: "noindex, nofollow" }];
}
export function headers() {
  return staffHeaders;
}

export function loader() {
  return null;
}

/** The one-time link (or the bootstrap secret) registers the first passkey and signs the member in. A link that does not verify is not used up. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertStaffCsrf(request, form);
  const token = String(form.get("token") ?? "").trim();
  const challengeId = String(form.get("challengeId") ?? "");
  if (!token || token.length > 200 || !checkPasskeyChallenge(session, challengeId, "create").ok) return staffForm({ message: "That enrolment request expired. Start again." }, 400);
  let credential: unknown;
  try { credential = JSON.parse(String(form.get("credential") ?? "")); } catch { return staffForm({ message: "That passkey could not be read. Try again." }, 400); }
  const name = String(form.get("name") ?? "").trim().slice(0, 60) || "Passkey";
  try {
    const { token: sessionToken } = await staffApi.enrol(staffCtx(request, context, session), { token, challengeId, name, credential });
    return redirect("/staff", { headers: { ...staffHeaders, "Set-Cookie": signedInCookie(sessionToken) } });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 400 || e.status === 409)) return staffForm({ message: "This link is invalid, used or expired, or the passkey was refused. Ask an admin for a new link." }, 400);
    return staffForm({ message: "The service is temporarily unavailable. Please try again." }, 503);
  }
}

export default function StaffEnrol() {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const submit = useSubmit();
  const csrf = useStaffLayout().csrf;
  const supported = usePasskeysSupported();
  const tokenInput = () => document.getElementById("staff-token") as HTMLInputElement | null;
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // the link carries the secret after `#`, which no server or proxy ever sees
  // The address is cleaned FIRST (so even a malformed secret does not stay in the address bar), then read; history.state is kept.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    history.replaceState(history.state, "", window.location.pathname + window.location.search);
    const el = tokenInput();
    const t = tokenFromHash(hash);
    if (t && el) el.value = t;
  }, []);

  async function enrol() {
    setError(null);
    const token = (tokenInput()?.value ?? "").trim();
    if (token.length < 8) { setError("Paste the one-time secret you were given."); return; }
    setWorking(true);
    try {
      const res = await fetch("/staff/passkey/enrol", { method: "POST", body: new URLSearchParams({ csrf, token }), credentials: "same-origin" });
      if (res.status === 400) { setError("This link is invalid, used or expired. Ask an admin for a new one."); return; }
      if (!res.ok) throw new Error("options");
      const { challengeId, options } = (await res.json()) as { challengeId: string; options: Record<string, unknown> };
      const credential = await createPasskey(options);
      const fd = new FormData();
      fd.set("csrf", csrf); fd.set("token", token); fd.set("challengeId", challengeId); fd.set("credential", JSON.stringify(credential));
      fd.set("name", (document.getElementById("passkey-name") as HTMLInputElement | null)?.value ?? "");
      submit(fd, { method: "post" });
    } catch (e) {
      const cancelled = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");
      setError(cancelled ? "Passkey setup was cancelled." : "We could not set up a passkey on this device. Please try again.");
    } finally { setWorking(false); }
  }

  return (
    <Card className="stack u-max-width-480px">
      <h2>Enrol a passkey</h2>
      <p className="muted">Paste the one-time secret you were given (or open your link). It works once. Your passkey is then how you sign in.</p>
      {supported === false && <FormMessage kind="error">This browser or device does not support passkeys.</FormMessage>}
      {(error || a?.message) && <FormMessage kind="error">{error ?? a?.message}</FormMessage>}
      <Input label="One-time secret" name="token" id="staff-token" autoComplete="off" spellCheck={false} />
      <Input label="Passkey name" name="name" id="passkey-name" defaultValue="Work laptop" maxLength={60} />
      <Button onClick={enrol} disabled={!supported || working || busy}>{working ? "Waiting for your device…" : "Create my passkey"}</Button>
    </Card>
  );
}
