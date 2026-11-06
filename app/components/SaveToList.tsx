import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useRootData } from "./Shell";
import { Button } from "./ui/form";
import { NAME_MAX } from "~/lib/lists";

interface Panel { signedIn: boolean; lists: { id: string; name: string; has: boolean }[]; limit?: number; unavailable?: boolean }

/**
 * "Save to a list" on a product page (M6). The page is public and carries no session, so the box asks `/wishlists/panel` from the browser once it is opened. The calls are plain
 * `fetch`es to the site's own resource route (like the search box), not router fetchers: a fetcher sent to a route the router has not discovered yet lands on the not-found route and
 * puts the error page over the product. A guest is sent to sign in and brought back. Each list is a toggle with its state as text ("Saved" / "Not saved"), not colour.
 */
export function SaveToList({ listingId, title }: { listingId: string; title: string }) {
  const root = useRootData();
  const location = useLocation();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const asked = useRef(false);
  const signedIn = !!root?.user;

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/wishlists/panel?listingId=${encodeURIComponent(listingId)}`, { headers: { Accept: "application/json" } });
      setPanel(r.ok ? ((await r.json()) as Panel) : { signedIn: true, lists: [], unavailable: true });
    } catch { setPanel({ signedIn: true, lists: [], unavailable: true }); }
  }, [listingId]);

  useEffect(() => {
    if (open && signedIn && !asked.current) { asked.current = true; void load(); }
  }, [open, signedIn, load]);

  const send = async (fields: Record<string, string>) => {
    const f = new FormData();
    f.set("csrf", root?.csrf ?? ""); f.set("listingId", listingId);
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    setBusy(true); setStatus("");
    try {
      const r = await fetch("/wishlists/panel", { method: "POST", body: f, headers: { Accept: "application/json" } });
      const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      setStatus(body.ok ? "Saved your change." : body.error ?? "Please try again.");
      if (body.ok) await load();
    } catch { setStatus("Please try again."); }
    setBusy(false);
  };

  const lists = panel?.lists ?? [];
  return (
    <details className="save-to-list" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="btn btn-secondary">Save to a list</summary>
      <div className="stack u-margin-top-var-s2">
        {!signedIn ? (
          <p><Link to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in</Link> to save {title} to a list.</p>
        ) : !panel ? (
          <p className="muted">Loading your lists…</p>
        ) : panel.unavailable ? (
          <p role="alert">We couldn't load your lists. Please try again later.</p>
        ) : (
          <>
            {lists.length === 0 && <p className="muted">You have no lists yet. Name one to save this item.</p>}
            <ul className="stack u-list-style-none-padding-0">
              {lists.map((l) => (
                <li key={l.id} className="row u-justify-content-space-between">
                  <span>{l.name} <span className="muted">· {l.has ? "Saved" : "Not saved"}</span></span>
                  <Button type="button" variant="secondary" disabled={busy} aria-label={`${l.has ? "Remove from" : "Save to"} ${l.name}`} onClick={() => void send({ intent: l.has ? "remove" : "add", wishlistId: l.id })}>{l.has ? "Remove" : "Save"}</Button>
                </li>
              ))}
            </ul>
            <form className="row u-align-items-flex-end" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const name = String(new FormData(form).get("name") ?? "").trim(); if (name) { void send({ intent: "create", name }); form.reset(); } }}>
              <label className="field"><span>New list</span><input className="input" name="name" maxLength={NAME_MAX} autoComplete="off" /></label>
              <Button type="submit" variant="secondary" disabled={busy}>Create and save</Button>
            </form>
            <p><Link to="/account/wishlists">Manage your lists</Link></p>
          </>
        )}
        <p role="status" className="muted" aria-live="polite">{status}</p>
      </div>
    </details>
  );
}
