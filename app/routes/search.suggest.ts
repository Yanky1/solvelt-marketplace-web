import type { Route } from "./+types/search.suggest";
import { apiCtx } from "~/lib/auth.server";
import { catalog } from "~/lib/catalog.server";
import { cleanQuery } from "~/lib/search";

/**
 * Autocomplete for the header search box: `GET /search/suggest?q=`. A typed route (O-12), not a proxy: the browser calls only this, the text is cleaned and
 * bounded here, and the API call carries no session (the answer is the same for everyone, and it is never cached: W2-01). Any failure is an empty 503 so the
 * box quietly offers nothing and the visitor can still press Enter to search.
 */
const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };       // nosniff and the rest come from the server for every response

export async function loader({ request, context }: Route.LoaderArgs) {
  const q = cleanQuery(new URL(request.url).searchParams.get("q") ?? "");
  try {
    const suggestions = await catalog.suggest(apiCtx(request, context, null), q);
    return new Response(JSON.stringify({ query: q, suggestions }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ query: q, suggestions: [] }), { status: 503, headers });
  }
}
