import type { Route } from "./+types/bookings.$id.calendar.ics";
import { api } from "~/lib/api-client.server";
import { privateHeaders, requireAccount } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";

/** The add-to-calendar file of the buyer's own booking: always a download, only `text/calendar`, `private, no-store`; the file name is cut down to letters, digits and dashes. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(params.id)) throw new Response("Not found", { status: 404, headers: privateHeaders });
  let res: Response;
  try { res = await api.bookingCalendar(ctx, params.id); } catch { throw new Response("Unavailable", { status: 503, headers: privateHeaders }); }
  if (res.status === 401) throw new Response("Unauthorized", { status: 401, headers: privateHeaders });
  if (res.status === 404) throw new Response("Not found", { status: 404, headers: privateHeaders });
  const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!res.ok || type !== "text/calendar") throw new Response("Not available", { status: 502, headers: privateHeaders });
  const stem = (/filename="?([^";]+?)(?:\.ics)?"?(?:;|$)/i.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "booking").replace(/[^A-Za-z0-9-]/g, "").slice(0, 60) || "booking";
  return new Response(res.body, { status: 200, headers: { ...privateHeaders, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${stem}.ics"`, "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
