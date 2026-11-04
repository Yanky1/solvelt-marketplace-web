import { useState } from "react";
import { Form, useSubmit } from "react-router";
import { Badge, Price } from "./ui/display";
import type { Variant } from "~/lib/catalog";

/**
 * Choose a variant: a radio group (one tab stop, arrow keys, the browser's own semantics). The choice lives in the URL (`?variant=<id>`), so the server renders
 * the right price and stock and a link can be shared; changing it replaces the history entry and does not scroll. Without JavaScript the "Show price" button
 * submits the same form.
 */
export function VariantPicker({ variants, selectedId, currency }: { variants: Variant[]; selectedId: string; currency: string }) {
  const submit = useSubmit();
  // Local state so the radio moves the moment it is clicked (a controlled radio with no state snaps back before the address has changed); the address stays the source of truth.
  const [state, setState] = useState({ from: selectedId, chosen: selectedId });
  // When the address changes the choice follows it (state adjusted during render, not in an effect).
  if (state.from !== selectedId) setState({ from: selectedId, chosen: selectedId });
  const chosen = state.from === selectedId ? state.chosen : selectedId;
  const setChosen = (id: string) => setState({ from: selectedId, chosen: id });
  if (variants.length < 2) return null;
  return (
    <Form method="get" replace preventScrollReset onChange={(e) => submit(e.currentTarget, { replace: true, preventScrollReset: true })}>
      <fieldset className="variants">
        <legend>Choose an option</legend>
        {variants.map((v) => (
          <label key={v.id} className={`variant${v.id === chosen ? " variant-selected" : ""}${v.available ? "" : " variant-soldout"}`}>
            <input type="radio" name="variant" value={v.id} checked={v.id === chosen} disabled={!v.available && v.id !== selectedId} onChange={() => setChosen(v.id)} />
            <span className="variant-name">{v.name}</span>
            <span className="variant-price"><Price cents={v.priceCents} wasCents={v.compareAtCents ?? undefined} currency={currency} /></span>
            {!v.available && <Badge tone="neutral">Sold out</Badge>}
          </label>
        ))}
      </fieldset>
      <noscript><button type="submit" className="btn btn-secondary">Show price</button></noscript>
    </Form>
  );
}
