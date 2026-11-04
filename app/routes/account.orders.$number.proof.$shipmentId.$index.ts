import type { Route } from "./+types/account.orders.$number.proof.$shipmentId.$index";
import { ApiError, api } from "~/lib/api-client.server";
import { privateHeaders, requireAccount } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";

/**
 * Proof-of-delivery images, proxied: the API fetches them from the portal with a short-lived link, so the browser never sees that link. Only images come out
 * (the API decides the type from the bytes; we pass through only an image type), `nosniff` comes from the server-wide security headers (W1-17; adding it here doubled it), a CSP that allows nothing, `private, no-store`.
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  const index = Number(params.index);
  if (!isSafeId(params.number) || !isSafeId(params.shipmentId) || !Number.isInteger(index) || index < 0 || index > 20) throw new Response("Not found", { status: 404, headers: privateHeaders });
  let res: Response;
  try { res = await api.proofImage(ctx, params.number, params.shipmentId, index); } catch (e) { throw new Response("Unavailable", { status: e instanceof ApiError ? 503 : 503, headers: privateHeaders }); }
  const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (res.status === 401) throw new Response("Unauthorized", { status: 401, headers: privateHeaders });
  if (res.status === 404) throw new Response("Not found", { status: 404, headers: privateHeaders });
  if (!res.ok || !["image/jpeg", "image/png", "image/webp"].includes(type)) throw new Response("Not available", { status: 502, headers: privateHeaders });
  return new Response(res.body, {
    status: 200,
    headers: { ...privateHeaders, "Content-Type": type, "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline; filename=\"proof\"" },
  });
}
