import { data, redirect } from "react-router";
import type { Route } from "./+types/cart.items";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, privateHeaders } from "~/lib/auth.server";
import { cookieFor } from "~/lib/cart.server";
import { isSafeId } from "~/lib/passkey.server";

/** The add-to-cart action (the product page's slot posts here: listingId, variantId, qty, csrf). A GET has nothing to show. */
export function loader() {
  return redirect("/cart");
}

/** The notices /cart may show, by code: an allow-list, so nothing the API says reaches the page. */
export const CART_NOTICES = ["added", "unavailable", "full", "quantity", "busy", "retry"] as const;

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const variantId = String(form.get("variantId") ?? "");
  const quantity = Number(form.get("qty") ?? "1");
  if (!isSafeId(variantId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw data("Bad request", { status: 400 });
  try {
    const cart = await api.cartAdd(apiCtx(request, context, session), session.cart, { variantId, quantity });
    const { setCookie } = cookieFor(session, cart) as { setCookie?: string };
    return redirect("/cart?notice=added", { headers: { ...(setCookie ? { "Set-Cookie": setCookie } : {}), ...privateHeaders } });
  } catch (e) {
    const notice = e instanceof ApiError
      ? e.code === "cart_full" ? "full" : e.code === "quantity_limit" ? "quantity" : e.code === "cart_busy" ? "busy" : e.status === 404 || e.status === 422 ? "unavailable" : "retry"
      : "retry";
    return redirect(`/cart?notice=${notice}`, { headers: privateHeaders });
  }
}
