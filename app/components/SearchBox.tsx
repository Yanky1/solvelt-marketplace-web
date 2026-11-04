import { useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "./ui/form";
import { cleanQuery, SUGGEST_MIN, type Suggestion } from "~/lib/search";
import { brandPath, categoryPath, listingPath } from "~/lib/urls";

const KIND_LABEL: Record<Suggestion["kind"], string> = { listing: "Product or service", brand: "Brand", category: "Category" };
const hrefFor = (s: Suggestion): string => (s.kind === "listing" ? listingPath(s.slug) : s.kind === "brand" ? brandPath(s.slug) : categoryPath(s.slug));
export const SUGGEST_DELAY_MS = 150;

/**
 * The header search box: a plain GET form to /search (it works without scripts) whose input is an ARIA 1.2 combobox with a list of suggestions. Focus stays in
 * the input; the active option is named by `aria-activedescendant`; Down/Up move, Enter opens the active option (or searches when none is active), Escape
 * closes, Tab leaves. Requests wait 150 ms after the last keystroke, an older request is cancelled when a newer one starts, and an answer for text that is no
 * longer in the box is ignored. A failure just shows no suggestions.
 */
export function SearchBox() {
  const id = useId();
  const listId = `${id}-list`, optionId = (i: number) => `${id}-opt-${i}`;
  const navigate = useNavigate();
  const location = useLocation();
  const onSearchPage = location.pathname === "/search";
  const fromAddress = onSearchPage ? (new URLSearchParams(location.search).get("q") ?? "") : "";
  const [text, setText] = useState(fromAddress);
  const [seen, setSeen] = useState(fromAddress);
  if (seen !== fromAddress) { setSeen(fromAddress); setText(fromAddress); }          // the box follows the address (a link to another search), state adjusted while rendering
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef(false);                                                         // suggestions only follow typing, never the address changing under the box

  useEffect(() => {
    if (!typed.current) return;
    const q = cleanQuery(text);
    if ([...q].length < SUGGEST_MIN) return;                                             // too short to ask: the list is hidden below, nothing is set here
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/search/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("no suggestions");
        const body = (await res.json()) as { query?: string; suggestions?: Suggestion[] };
        if (controller.signal.aborted || !Array.isArray(body.suggestions)) return;            // stale: the box has moved on (every change cancels the request before it)
        const next = body.suggestions.filter((s) => s && typeof s.text === "string" && typeof s.slug === "string" && (s.kind === "listing" || s.kind === "brand" || s.kind === "category"));
        setItems(next); setActive(-1); setOpen(next.length > 0);
      } catch {
        if (!controller.signal.aborted) { setItems([]); setOpen(false); }
      }
    }, SUGGEST_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [text]);

  const tooShort = [...cleanQuery(text)].length < SUGGEST_MIN;
  const shown = open && !tooShort && items.length > 0;
  const close = () => { setOpen(false); setActive(-1); };
  const go = (s: Suggestion) => { close(); typed.current = false; navigate(hrefFor(s)); };

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (items.length === 0 || tooShort) return;
      e.preventDefault();
      if (!open) { setOpen(true); setActive(e.key === "ArrowDown" ? 0 : items.length - 1); return; }
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % items.length : (a <= 0 ? items.length - 1 : a - 1)));
    } else if (e.key === "Enter") {
      if (shown && active >= 0 && items[active]) { e.preventDefault(); go(items[active]!); }          // otherwise the form submits and searches
    } else if (e.key === "Escape") {
      if (shown) { e.preventDefault(); close(); }
    } else if (e.key === "Home" && shown && active >= 0) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && shown && active >= 0) { e.preventDefault(); setActive(items.length - 1); }
  }

  return (
    <form className="search" role="search" action="/search" method="get" onSubmit={() => { close(); typed.current = false; }}>
      <label htmlFor="site-search" className="sr-only">Search Solvelt</label>
      <div className="search-field">
        <input
          id="site-search" name="q" type="search" className="input" placeholder="Search products and services" autoComplete="off" value={text} maxLength={200}
          role="combobox" aria-expanded={shown} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox" aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
          onChange={(e) => { typed.current = true; setText(e.target.value); }}
          onKeyDown={onKeyDown}
          onBlur={() => close()}
          onFocus={() => { if (items.length > 0 && typed.current) setOpen(true); }}
        />
        <ul id={listId} role="listbox" aria-label="Suggestions" className="search-suggestions" hidden={!shown}>
          {items.map((s, i) => (
            // Options are not focusable in the combobox pattern: keyboard users act through the input (Down/Up/Enter above); the click is the mouse's route.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li key={`${s.kind}:${s.slug}`} id={optionId(i)} role="option" aria-selected={i === active} className={i === active ? "search-option search-option-active" : "search-option"}
              onMouseDown={(e) => e.preventDefault()} onClick={() => go(s)} onMouseMove={() => { if (active !== i) setActive(i); }}>
              <span className="search-option-text">{s.text}</span>
              <span className="search-option-kind">{KIND_LABEL[s.kind]}</span>
            </li>
          ))}
        </ul>
        <div className="sr-only" role="status" aria-live="polite">{shown ? `${items.length} ${items.length === 1 ? "suggestion" : "suggestions"} available. Use the up and down arrow keys.` : ""}</div>
      </div>
      <Button type="submit" variant="primary">Search</Button>
    </form>
  );
}
