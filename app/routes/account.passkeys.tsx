import { useState } from "react";
import { Form, Link, redirect, useActionData, useNavigation, useSubmit } from "react-router";
import type { Route } from "./+types/account.passkeys";
import { AccountNav } from "~/components/AccountNav";
import { ErrorSummary, FormMessage } from "~/components/AuthForm";
import { CsrfField, useRootData } from "~/components/Shell";
import { Card, EmptyState } from "~/components/ui/display";
import { Button, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { hasRecentAuth, sessionCookie, checkPasskeyChallenge, withoutPasskeyChallenge } from "~/lib/session.server";
import { isSafeId } from "~/lib/passkey.server";
import { createPasskey, usePasskeysSupported } from "~/lib/webauthn";
import { cleanText, str } from "~/lib/validation";

export function meta() {
  return [{ title: "Passkeys | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  try {
    // Only a known key selects the message; nothing from the query string is ever shown.
    return { passkeys: await api.passkeys(ctx), removedAll: new URL(request.url).searchParams.get("done") === "all-removed" };
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const cfg = getConfig();
  const intent = str(form, "intent");
  // A registration challenge is single use: drop the binding from the cookie whatever the outcome.
  const dropBinding = { "Set-Cookie": sessionCookie(withoutPasskeyChallenge(session), cfg) };
  try {
    if (intent === "register") {
      if (!hasRecentAuth(session, Date.now() / 1000, cfg.reauthWindowSeconds)) return redirect("/account/confirm?next=%2Faccount%2Fpasskeys", { headers: { ...privateHeaders, ...dropBinding } });
      if (!checkPasskeyChallenge(session, str(form, "challengeId"), "create").ok) return formError({ message: "That passkey request expired or does not belong to this session. Please try again." }, 400, dropBinding);
      const name = cleanText(str(form, "name")).trim().slice(0, 60) || "My passkey";
      let credential: unknown;
      try { credential = JSON.parse(str(form, "credential")); } catch { return formError({ message: "That passkey could not be read. Please try again." }, 400, dropBinding); }
      await api.registerPasskey(ctx, { challengeId: str(form, "challengeId"), name, credential });
      return redirect("/account/passkeys", { headers: { ...privateHeaders, ...dropBinding } });
    }
    if (intent === "delete") {
      const id = str(form, "id");
      if (!isSafeId(id)) throw new Response("Not found", { status: 404, headers: privateHeaders });
      // Removing a sign-in method needs a recent sign-in (O-11): otherwise ask the user to confirm it is them first.
      if (!hasRecentAuth(session, Date.now() / 1000, cfg.reauthWindowSeconds)) return redirect("/account/confirm?next=%2Faccount%2Fpasskeys", { headers: privateHeaders });
      try {
        await api.deletePasskey(ctx, id);
      } catch (e) {
        if (e instanceof ApiError && e.status !== 401 && e.status !== 404) return formError({ message: "We could not remove that passkey. Please try again." }, 503);
        throw e;
      }
      return redirect("/account/passkeys", { headers: privateHeaders });
    }
    throw new Response("Bad request", { status: 400 });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 400 || e.status === 409 || e.status === 422)) return formError({ message: "We could not add that passkey. It may already be registered, or the request expired." }, e.status, dropBinding);
    return failAccount(e, request, dropBinding); // API 5xx/401 and thrown 404s must not leave the challenge bound either
  }
}

export default function Passkeys({ loaderData }: Route.ComponentProps) {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const submit = useSubmit();
  const csrf = useRootData()?.csrf ?? "";
  const supported = usePasskeysSupported(); // null until hydrated: keeps SSR and client markup equal
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function add() {
    setError(null);
    setWorking(true);
    try {
      const res = await fetch("/account/passkeys/options", { method: "POST", body: new URLSearchParams({ csrf }), credentials: "same-origin" });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string; redirectTo?: string } | null;
        if (body?.code === "reauth_required" && typeof body.redirectTo === "string" && body.redirectTo.startsWith("/account/confirm")) {
          window.location.assign(body.redirectTo); // ask for the password first, then come back
          return;
        }
      }
      if (!res.ok) throw new Error("options");
      const { challengeId, options } = (await res.json()) as { challengeId: string; options: Record<string, unknown> };
      const credential = await createPasskey(options);
      const fd = new FormData();
      fd.set("csrf", csrf); fd.set("intent", "register"); fd.set("challengeId", challengeId);
      fd.set("name", (document.getElementById("passkey-name") as HTMLInputElement | null)?.value ?? ""); fd.set("credential", JSON.stringify(credential));
      submit(fd, { method: "post" });
    } catch (e) {
      const cancelled = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");
      setError(cancelled ? "Passkey setup was cancelled." : "We could not set up a passkey on this device. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <h2>Passkeys</h2>
      <p className="muted">A passkey lets you sign in with your fingerprint, face or device PIN instead of a password.</p>
      <ErrorSummary submission={a} message={a?.message} />
      {loaderData.removedAll && <FormMessage kind="ok">All passkeys removed. You sign in with your password now.</FormMessage>}
      {loaderData.passkeys.length === 0 ? (
        <EmptyState title="No passkeys yet">Add one to sign in faster on this device.</EmptyState>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }} className="stack">
          {loaderData.passkeys.map((p) => (
            <li key={p.id}>
              <Card className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted">Added {new Date(p.createdAt).toISOString().slice(0, 10)}{p.lastUsedAt ? `, last used ${new Date(p.lastUsedAt).toISOString().slice(0, 10)}` : ""}</div>
                </div>
                <Form method="post">
                  <CsrfField /><input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={p.id} />
                  <Button type="submit" variant="secondary" disabled={busy} aria-label={`Remove passkey ${p.name}`}>Remove</Button>
                </Form>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {loaderData.passkeys.length > 1 && <p><Link to="/account/passkeys/remove-all">Remove all passkeys</Link></p>}
      <Card className="stack" style={{ marginTop: "var(--s3)" }}>
        <h3>Add a passkey</h3>
        {supported === false && <FormMessage kind="error">This browser or device does not support passkeys.</FormMessage>}
        {error && <FormMessage kind="error">{error}</FormMessage>}
        <Input label="Passkey name" name="name" defaultValue="My passkey" hint="For example: Work laptop" maxLength={60} id="passkey-name" />
        <Button onClick={add} disabled={!supported || working || busy}>{working ? "Waiting for your device…" : "Add a passkey"}</Button>
      </Card>
    </div>
  );
}
