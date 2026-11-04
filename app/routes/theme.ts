import { redirect } from "react-router";
import type { Route } from "./+types/theme";
import { getConfig } from "~/lib/config.server";
import { assertCsrf } from "~/lib/auth.server";
import { safeNext } from "~/lib/csrf.server";
import { themeCookie, type ThemePref } from "~/lib/theme.server";

export async function action({ request }: Route.ActionArgs) {
  const cfg = getConfig();
  const form = await request.formData();
  assertCsrf(request, form); // Origin check plus per-session token
  const t = form.get("theme");
  const pref: ThemePref = t === "light" || t === "dark" ? t : "system";
  return redirect(safeNext(String(form.get("redirectTo") ?? "/")), {
    headers: { "Set-Cookie": themeCookie(pref, cfg.publicOrigin.startsWith("https://")) },
  });
}

export function loader() {
  throw new Response("Not found", { status: 404 });
}
