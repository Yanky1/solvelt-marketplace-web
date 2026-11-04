import { useState } from "react";
import { Form, redirect, useActionData, useNavigation, useSubmit } from "react-router";
import type { Route } from "./+types/account.passkeys";
import { AccountNav } from "~/components/AccountNav";
import { FormMessage } from "~/components/AuthForm";
import { CsrfField, useRootData } from "~/components/Shell";
import { Card, EmptyState } from "~/components/ui/display";
import { Button, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { createPasskey, usePasskeysSupported } from "~/lib/webauthn";
import { str } from "~/lib/validation";

export function meta() {
  return [{ title: "Passkeys | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  try {
    return { passkeys: await api.passkeys(ctx) };
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const intent = str(form, "intent");
  try {
    if (intent === "register") {
      const name = str(form, "name").trim().slice(0, 60) || "My passkey";
      let credential: unknown;
      try { credential = JSON.parse(str(form, "credential")); } catch { return formError({ message: "That passkey could not be read. Please try again." }); }
      await api.registerPasskey(ctx, { challengeId: str(form, "challengeId"), name, credential });
    } else if (intent === "delete" && str(form, "id")) {
      await api.deletePasskey(ctx, str(form, "id"));
    } else {
      throw new Response("Bad request", { status: 400 });
    }
  } catch (e) {
    if (e instanceof ApiError && (e.status === 400 || e.status === 409 || e.status === 422)) return formError({ message: "We could not add that passkey. It may already be registered, or the request expired." }, e.status);
    return failAccount(e, request);
  }
  return redirect("/account/passkeys", { headers: privateHeaders });
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
      {a?.message && <FormMessage kind="error">{a.message}</FormMessage>}
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
