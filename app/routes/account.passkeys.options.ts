import type { Route } from "./+types/account.passkeys.options";
import { api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, requireAccount } from "~/lib/auth.server";

/** Registration challenge for the signed-in user; called by browser JS with the CSRF token in the body. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  try {
    return Response.json(await api.passkeyRegistrationOptions(ctx), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failAccount(e, request);
  }
}

export function loader() {
  throw new Response("Not found", { status: 404 });
}
