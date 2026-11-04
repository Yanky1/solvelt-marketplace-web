import { redirect, useActionData } from "react-router";
import type { Route } from "./+types/account.addresses.new";
import { AccountNav } from "~/components/AccountNav";
import { AddressForm, EMPTY_ADDRESS } from "~/components/AddressForm";
import { AuthPage, ErrorSummary } from "~/components/AuthForm";
import { safeFieldErrors } from "~/lib/api-errors";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { readAddress, validateAddress, type FieldErrors } from "~/lib/validation";

export function meta() {
  return [{ title: "Add an address | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export function loader({ request, context }: Route.LoaderArgs) {
  requireAccount(request, context);
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const values = readAddress(form);
  const fieldErrors = validateAddress(values);
  if (Object.keys(fieldErrors).length) return formError({ fieldErrors, message: null, values });
  try {
    await api.createAddress(ctx, values);
  } catch (e) {
    if (e instanceof ApiError && e.status === 422 && e.fieldErrors) return formError({ fieldErrors: safeFieldErrors(e.fieldErrors, ["fullName", "line1", "line2", "city", "region", "postalCode", "country", "phone"]), message: null, values }, 422);
    if (e instanceof ApiError && e.status !== 401 && e.status !== 404) return formError({ fieldErrors: {} as FieldErrors, message: "We could not save the address right now. Please try again.", values }, 503);
    return failAccount(e, request);
  }
  return redirect("/account/addresses", { headers: privateHeaders });
}

export default function NewAddress() {
  const a = useActionData<typeof action>();
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <AuthPage title="Add an address">
        <ErrorSummary submission={a} message={a?.message} errors={a?.fieldErrors} />
        <AddressForm values={a?.values ?? EMPTY_ADDRESS} errors={a?.fieldErrors} submitLabel="Save address" />
      </AuthPage>
    </div>
  );
}
