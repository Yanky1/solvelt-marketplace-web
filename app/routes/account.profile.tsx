import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/account.profile";
import { AccountNav } from "~/components/AccountNav";
import { AuthPage, ErrorSummary, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Input } from "~/components/ui/form";
import { safeFieldErrors } from "~/lib/api-errors";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { str, validateDisplayName, validatePhone, type FieldErrors } from "~/lib/validation";

export function meta() {
  return [{ title: "Profile | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  try {
    const p = await api.profile(ctx);
    return { displayName: p.displayName, email: p.email, phone: p.phone ?? "" };
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const displayName = str(form, "displayName").trim();
  const phone = str(form, "phone").trim();
  const fieldErrors: FieldErrors = {};
  const e1 = validateDisplayName(displayName), e2 = validatePhone(phone);
  if (e1) fieldErrors.displayName = e1;
  if (e2) fieldErrors.phone = e2;
  if (Object.keys(fieldErrors).length) return formError({ fieldErrors, message: null, displayName, phone });
  try {
    await api.updateProfile(ctx, { displayName, phone });
  } catch (e) {
    if (e instanceof ApiError && e.status === 422 && e.fieldErrors) return formError({ fieldErrors: safeFieldErrors(e.fieldErrors, ["displayName", "phone"]), message: null, displayName, phone }, 422);
    if (e instanceof ApiError && e.status !== 401 && e.status !== 404) return formError({ fieldErrors: {} as FieldErrors, message: "We could not save your profile right now. Please try again.", displayName, phone }, 503);
    return failAccount(e, request);
  }
  return redirect("/account/profile?saved=1", { headers: privateHeaders });
}

export default function Profile({ loaderData }: Route.ComponentProps) {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const saved = typeof window !== "undefined" ? new URLSearchParams(window.location.search).has("saved") : false;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <AuthPage title="Profile">
        <Form method="post" className="stack" noValidate>
          <CsrfField />
          {saved && !a && <FormMessage kind="ok">Profile saved.</FormMessage>}
          <ErrorSummary submission={a} message={a?.message} errors={a?.fieldErrors} />
          <Input label="Name" name="displayName" autoComplete="name" defaultValue={a?.displayName ?? loaderData.displayName} error={a?.fieldErrors?.displayName} required />
          <Input label="Email" name="email" type="email" value={loaderData.email} readOnly hint="To change your email address, contact support." />
          <Input label="Phone (optional)" name="phone" type="tel" autoComplete="tel" defaultValue={a?.phone ?? loaderData.phone} error={a?.fieldErrors?.phone} />
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button>
        </Form>
      </AuthPage>
    </div>
  );
}
