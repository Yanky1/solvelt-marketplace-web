import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/account.password";
import { AccountNav } from "~/components/AccountNav";
import { ErrorSummary, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Card } from "~/components/ui/display";
import { Button, Checkbox, Input } from "~/components/ui/form";
import { safeFieldErrors } from "~/lib/api-errors";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, cookieWithNewToken, failAccount, formError, privateHeaders, requireAccount, rotatedCookie, signInRedirect } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { retryAfterHeader, tooManyMessage } from "~/lib/rate-limit";
import { hasRecentAuth } from "~/lib/session.server";
import { str, validateNewPassword, type FieldErrors } from "~/lib/validation";

/**
 * Change password (POST /account/password). Needs a recent sign-in like every sensitive change; the API signs the other devices out. With passkeys on the account a box
 * offers to remove them in the same step (M1-85: a password change keeps passkeys unless asked). An API that predates that field ignores it, so after a ticked box the list is
 * read again and the page says honestly what happened. Passwords are never echoed back into a page.
 */
export function meta() {
  return [{ title: "Change password | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

const BACK = "/account/password";
const CONFIRM = `/account/confirm?next=${encodeURIComponent(BACK)}`;
/** Only these keys select a message; nothing from the query string is ever shown. */
const NOTICES = {
  changed: "Password changed. Your other devices were signed out.",
  removed: "Password changed, and your passkeys were removed. Your other devices were signed out.",
  kept: "Password changed and your other devices were signed out, but your passkeys could not be removed this way. You can remove them on the passkeys page.",
  unconfirmed: "Password changed and your other devices were signed out. We couldn't confirm whether your passkeys were removed: please check the passkeys page.",
} as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  const key = new URL(request.url).searchParams.get("done");
  const notice: keyof typeof NOTICES | null = key === "changed" || key === "removed" || key === "kept" || key === "unconfirmed" ? key : null;
  try {
    // The box is offered when there are passkeys to remove (or when we cannot tell: asking is harmless).
    // A dead session (401) is not "unknown": it goes to the sign-in page like on every account page (LOW-4). Anything else we cannot tell, and asking is harmless.
    const count = await api.passkeys(ctx).then((l) => l.length).catch((e: unknown) => { if (e instanceof ApiError && e.status === 401) throw e; return null; });
    return { notice, offerPasskeys: count === null || count > 0 };
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const current = str(form, "currentPassword");
  const next = str(form, "newPassword");
  const removePasskeys = str(form, "removePasskeys") === "true";
  const fieldErrors: FieldErrors = {};
  if (!current) fieldErrors.currentPassword = "Enter your current password.";
  const weak = validateNewPassword(next);
  if (weak) fieldErrors.newPassword = weak;
  else if (next === current) fieldErrors.newPassword = "Choose a password you have not used just now.";
  if (Object.keys(fieldErrors).length) return formError({ fieldErrors, message: null, removePasskeys });
  if (!hasRecentAuth(session, Date.now() / 1000, getConfig().reauthWindowSeconds)) return redirect(CONFIRM, { headers: privateHeaders });
  try {
    // The API ends every session of the account; since M1-87 it answers with a token for this caller, which replaces the one in the sealed cookie (a stolen copy of the old cookie is dead).
    // An API that still answers 204 keeps the caller's session: no new token, the cookie stays as it is. Every call after this one uses the NEW token.
    const newToken = await api.changePassword(ctx, { currentPassword: current, newPassword: next, ...(removePasskeys ? { removePasskeys: true } : {}) });
    const after = newToken ? { ...ctx, sessionToken: newToken } : ctx;
    const cookie: Record<string, string> = newToken ? { "Set-Cookie": cookieWithNewToken(session, newToken, true) } : {};
    let done: keyof typeof NOTICES = "changed";
    if (removePasskeys) {
      // What the API did is read back, never assumed: none left is "removed", some left is "kept" (an API that ignores the field), and a read that failed is "we couldn't confirm" (LOW-6),
      // which says neither that they were removed nor that they could not be.
      const left = await api.passkeys(after).then((l) => l.length).catch(() => null);
      done = left === null ? "unconfirmed" : left === 0 ? "removed" : "kept";
    }
    return redirect(`${BACK}?done=${done}`, { headers: { ...privateHeaders, ...cookie } });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 403) return redirect(CONFIRM, { headers: privateHeaders });                           // the API's own clock says "sign in again"
      if (e.status === 401 && e.code === "invalid_credentials") return formError({ fieldErrors: { currentPassword: "That is not your current password." }, message: null, removePasskeys }, 401);
      if (e.status === 422) return formError({ fieldErrors: safeFieldErrors(e.fieldErrors, ["newPassword"]), message: e.fieldErrors?.newPassword ? null : "Please check the new password and try again.", removePasskeys }, 422);
      if (e.status === 429) return formError({ fieldErrors: {}, message: tooManyMessage(e.retryAfter), removePasskeys }, 429, retryAfterHeader(e.retryAfter));   // the wait the API asked for (LOW-3)
      if (e.status === 409) signInRedirect(request, { "Set-Cookie": rotatedCookie(), ...privateHeaders });   // the account changed while this ran (a reset, say): the cookie's session is dead, so it is dropped and the person signs in again (LOW-3)
      if (e.status !== 401) return formError({ fieldErrors: {}, message: "We could not change your password right now. Please try again.", removePasskeys }, 503);
    }
    return failAccount(e, request);
  }
}

export default function Password({ loaderData }: Route.ComponentProps) {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const errors = (a?.fieldErrors ?? {}) as Record<string, string>;
  return (
    <div className="stack">
      <h1>Change password</h1>
      <AccountNav />
      <Card className="stack">
        {loaderData.notice && <FormMessage kind="ok">{NOTICES[loaderData.notice]}</FormMessage>}
        <ErrorSummary submission={a} message={a?.message} errors={errors} />
        <Form method="post" className="stack" noValidate>
          <CsrfField />
          <Input label="Current password" name="currentPassword" type="password" autoComplete="current-password" error={errors.currentPassword} required />
          <Input label="New password" name="newPassword" type="password" autoComplete="new-password" hint="At least 12 characters." error={errors.newPassword} required />
          {loaderData.offerPasskeys && <Checkbox name="removePasskeys" value="true" defaultChecked={a?.removePasskeys === true} label="Also remove my passkeys" />}
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</Button>
        </Form>
      </Card>
    </div>
  );
}
