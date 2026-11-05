import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ListingGrid } from "./ListingGrid";
import { useRootData } from "./Shell";
import { reconcileUserStorageInBrowser } from "~/lib/client-storage";
import { GUEST_VIEWED_KEY, clearGuestViewed, guestViewedIds, parseCard, parseGuestViewed, recordGuestView, type ListCardView } from "~/lib/lists";

// The guest list is kept in sessionStorage (this tab only, gone when it closes): on a shared computer the next person never inherits it (review MED-4).
// These components call the site's own resource route `/recently-viewed` with plain `fetch`es (see SaveToList for why they are not router fetchers).

function localStore(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

const VIEWED_EVENT = "solvelt:viewed-changed";
function subscribeViewed(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(VIEWED_EVENT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(VIEWED_EVENT, cb); };
}
const rawViewed = (): string => { try { return window.sessionStorage.getItem(GUEST_VIEWED_KEY) ?? ""; } catch { return ""; } };

function post(fields: Record<string, string>): Promise<Response> {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return fetch("/recently-viewed", { method: "POST", body: f, headers: { Accept: "application/json" } });
}

/** Records that the buyer looked at this listing: for a signed-in buyer on the server (the API stamps the time), for a guest in this browser (catalog data only). Renders nothing. */
export function RecordView({ card }: { card: ListCardView }) {
  const root = useRootData();
  const csrf = root?.csrf ?? "";
  const userId = root?.user?.id ?? null;
  const last = useRef("");
  useEffect(() => {
    const key = `${userId ?? "guest"}:${card.id}`;
    if (last.current === key) return;
    last.current = key;
    if (userId) void post({ csrf, intent: "record", listingId: card.id }).catch(() => undefined);
    else {
      const s = localStore();
      if (s) { recordGuestView(s, card); window.dispatchEvent(new Event(VIEWED_EVENT)); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, card.id]);
  return null;
}

/** The shelf: the account's list for a signed-in buyer, this browser's list for a guest. Hidden while empty. `exclude` leaves out the listing being shown. */
export function RecentlyViewedShelf({ exclude }: { exclude?: string }) {
  const root = useRootData();
  const userId = root?.user?.id ?? null;
  const [mine, setMine] = useState<ListCardView[]>([]);
  const rawGuest = useSyncExternalStore(subscribeViewed, rawViewed, () => "");
  const guest = useMemo(() => parseGuestViewed(rawGuest || null), [rawGuest]);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    // Slightly later than the page's own "record", so the listing just opened is already counted (and is left out below anyway).
    fetch("/recently-viewed", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((b: { items?: unknown[] }) => { if (live) setMine((b.items ?? []).map(parseCard).filter((c): c is ListCardView => c !== null)); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [userId, exclude]);
  const items = (userId ? mine : guest).filter((c) => c.id !== exclude).slice(0, 8);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="recently-viewed-h" className="stack" data-testid="recently-viewed">
      <h2 id="recently-viewed-h">Recently viewed</h2>
      <ListingGrid items={items} label="Recently viewed" />
    </section>
  );
}

/** After a guest signs in: the ids kept in this browser go to the account once, then they are removed from the browser. Renders nothing. */
export function MergeGuestViews() {
  const root = useRootData();
  const userId = root?.user?.id ?? null;
  const csrf = root?.csrf ?? "";
  const sent = useRef(false);
  useEffect(() => {
    if (!userId || sent.current) return;
    // Children's effects run before the root's, so the "different person on this browser" check runs HERE first: another buyer's leftovers are cleared, never merged into this account.
    reconcileUserStorageInBrowser(userId);
    const s = localStore();
    const ids = s ? guestViewedIds(s) : [];
    if (!s || !ids.length) return;
    sent.current = true;
    post({ csrf, intent: "merge", ids: ids.join(",") })
      .then((r) => { if (r.ok) { clearGuestViewed(s); window.dispatchEvent(new Event(VIEWED_EVENT)); } })
      .catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  return null;
}
