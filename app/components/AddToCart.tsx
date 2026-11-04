import { CsrfField } from "./Shell";
import { Button } from "./ui/form";

/**
 * THE ADD-TO-CART SLOT: the one component boundary the cart workstream (M3) fills.
 *
 * Contract. The product page renders `<AddToCart {...props} />` for a product that can be bought. M3 replaces the BODY of this component (this file only) with the
 * real form: it posts `{ listingId, variantId, qty }` (form fields of those names, plus the `csrf` field) to M3's cart action. Nothing else on the page changes,
 * and the props below are everything the page knows. `variantId` is always a variant of `listingId` that is `available`; the cart re-validates it server side.
 * Until the cart action exists the slot is a disabled button with a plain explanation, so a buyer is never offered a form that goes nowhere.
 */
export interface AddToCartProps {
  listingId: string;
  variantId: string;
  /** Names for the confirmation text and the accessible label. */
  title: string;
  variantName: string;
  /** Whole cents and currency of the chosen variant (display only: the cart re-prices on the server). */
  priceCents: number;
  currency: string;
}

/** Flip to true (and set `action`) when the cart action lands. */
export const CART_ACTION: { ready: boolean; action: string } = { ready: true, action: "/cart/items" };

export function AddToCart({ listingId, variantId, title, variantName }: AddToCartProps) {
  if (!CART_ACTION.ready) {
    return (
      <div className="add-to-cart" data-testid="add-to-cart-slot">
        <Button type="button" variant="primary" disabled aria-describedby="cart-soon">Add to cart</Button>
        <p id="cart-soon" className="muted">The cart opens soon. This item will be waiting for you.</p>
      </div>
    );
  }
  return (
    <form method="post" action={CART_ACTION.action} className="add-to-cart stack" data-testid="add-to-cart-slot">
      <CsrfField />
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="variantId" value={variantId} />
      <label className="row">Quantity
        <input name="qty" type="number" min={1} max={99} defaultValue={1} className="input" style={{ width: "5rem" }} />
      </label>
      <Button type="submit" variant="primary" aria-label={`Add ${title}, ${variantName}, to cart`}>Add to cart</Button>
    </form>
  );
}
