import type { Route } from "./+types/checkout.confirmation.$number";
import { OrderConfirmation } from "~/components/OrderConfirmation";
import { privateHeaders } from "~/lib/auth.server";
import { loadConfirmation } from "~/lib/confirmation.server";

export function meta() {
  return [{ title: "Your order | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

/** Where the buyer lands after Stripe (see `loadConfirmation`). */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  return loadConfirmation(request, context, params.number, `/checkout/confirmation/${encodeURIComponent(params.number)}`);
}

export default function Confirmation({ loaderData }: Route.ComponentProps) {
  return <OrderConfirmation order={loaderData.order} lost={loaderData.lost} />;
}
