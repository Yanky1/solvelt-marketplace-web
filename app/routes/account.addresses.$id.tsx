import { redirect, useActionData } from "react-router";
import type { Route } from "./+types/account.addresses.$id";
import { AccountNav } from "~/components/AccountNav";
import { AddressForm } from "~/components/AddressForm";
import { AuthPage, ErrorSummary } from "~/components/AuthForm";
import { safeFieldErrors } from "~/lib/api-errors";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";
import { readAddress, validateAddress, type FieldErrors } from "~/lib/validation";

export function meta() {
  return [{ title: "Edit address | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(params.id)) throw new Response("Not found", { status: 404, headers: privateHeaders });
  try {
    const a = await api.address(ctx, params.id); // another user's address is a 404 from the API (never 403)
    return { values: { fullName: a.fullName, line1: a.line1, line2: a.line2 ?? "", city: a.city, region: a.region ?? "", postalCode: a.postalCode, country: a.country, phone: a.phone ?? "", isDefault: a.isDefault } };
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(params.id)) throw new Response("Not found", { status: 404, headers: privateHeaders });
  const values = readAddress(form);
  const fieldErrors = validateAddress(values);
  if (Object.keys(fieldErrors).length) return formError({ fieldErrors, message: null, values });
  try {
    await api.updateAddress(ctx, params.id, values);
  } catch (e) {
    if (e instanceof ApiError && e.status === 422 && e.fieldErrors) return formError({ fieldErrors: safeFieldErrors(e.fieldErrors, ["fullName", "line1", "line2", "city", "region", "postalCode", "country", "phone"]), message: null, values }, 422);
    if (e instanceof ApiError && e.status !== 401 && e.status !== 404) return formError({ fieldErrors: {} as FieldErrors, message: "We could not save the address right now. Please try again.", values }, 503);
    return failAccount(e, request);
  }
  return redirect("/account/addresses", { headers: privateHeaders });
}

export default function EditAddress({ loaderData }: Route.ComponentProps) {
  const a = useActionData<typeof action>();
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <AuthPage title="Edit address">
        <ErrorSummary submission={a} message={a?.message} errors={a?.fieldErrors} />
        <AddressForm values={a?.values ?? loaderData.values} errors={a?.fieldErrors} submitLabel="Save changes" />
      </AuthPage>
    </div>
  );
}
