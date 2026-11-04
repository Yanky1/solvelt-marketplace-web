import type { Route } from "./+types/account.messages.attachments.$id";
import { api } from "~/lib/api-client.server";
import { privateHeaders, requireAccount } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";

const TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/**
 * A seller's file, as the API already checked and cleaned it. It is ALWAYS a download (`Content-Disposition: attachment`, never shown inside our pages), with only a type from
 * the allow-list, `nosniff` (server-wide headers, W1-17), a CSP that allows nothing and `private, no-store`. The file name comes from the API's header with anything
 * odd removed.
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(params.id)) throw new Response("Not found", { status: 404, headers: privateHeaders });
  let res: Response;
  try { res = await api.messageAttachment(ctx, params.id); } catch { throw new Response("Unavailable", { status: 503, headers: privateHeaders }); }
  if (res.status === 401) throw new Response("Unauthorized", { status: 401, headers: privateHeaders });
  if (res.status === 404) throw new Response("Not found", { status: 404, headers: privateHeaders });
  const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!res.ok || !TYPES.includes(type)) throw new Response("Not available", { status: 502, headers: privateHeaders });
  const name = /filename="?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "")?.[1]?.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 100) || "attachment";
  return new Response(res.body, {
    status: 200,
    headers: { ...privateHeaders, "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}
