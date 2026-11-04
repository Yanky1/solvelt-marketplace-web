import type { Route } from "./+types/passkeys.sign-in-options";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf } from "~/lib/auth.server";

/** Discoverable-credential challenge for anonymous passkey sign-in. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  try {
    return Response.json(await api.passkeySignInOptions(apiCtx(request, context, null)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    const status = e instanceof ApiError && e.status === 429 ? 429 : 503;
    return Response.json({ code: status === 429 ? "rate_limited" : "unavailable" }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}

export function loader() {
  throw new Response("Not found", { status: 404 });
}
