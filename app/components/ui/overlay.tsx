import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./form";

/** Native <dialog>: focus trap, Escape and inert background come from the browser. */
export function Modal({ open, onClose, title, variant = "modal", children }: { open: boolean; onClose: () => void; title: string; variant?: "modal" | "drawer"; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    // Backdrop click is a mouse convenience only; Escape and the close button cover the keyboard.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <dialog ref={ref} className={`modal ${variant === "drawer" ? "drawer" : ""}`} aria-label={title} onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="row u-justify-content-space-between">
        <h2 className="u-margin-0">{title}</h2>
        <Button variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
      </div>
      {children}
    </dialog>
  );
}

interface ToastItem { id: number; message: string }
const ToastCtx = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const push = useCallback((message: string) => {
    const id = next.current++;
    setItems((x) => [...x, { id, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className="toast">{t.message}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
