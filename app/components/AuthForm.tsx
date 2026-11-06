import { useEffect, useRef, type ReactNode } from "react";
import { Card } from "./ui/display";

export function AuthPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="u-max-width-480px-margin-inline-auto">
      <Card className="stack">
        <h1 className="u-font-size-var-fs-xl">{title}</h1>
        {intro && <p className="muted">{intro}</p>}
        {children}
      </Card>
    </div>
  );
}

/** Form-level message, announced to screen readers. */
export function FormMessage({ kind, children }: { kind: "error" | "ok"; children: ReactNode }) {
  return (
    <p role={kind === "error" ? "alert" : "status"} className={kind === "error" ? "field-error" : "badge badge-ok u-form-ok"}>
      {children}
    </p>
  );
}

/**
 * One focusable summary per failed submit (GOV.UK pattern): focus moves to it when the action data changes, it lists
 * each field error as a link to that field, and per-field messages are NOT announced separately.
 * `submission` is the action data object: a new object per submit re-triggers the focus.
 */
export function ErrorSummary({ submission, message, errors }: { submission: unknown; message?: string | null | undefined; errors?: Record<string, string> | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const entries = Object.entries(errors ?? {});
  const show = !!message || entries.length > 0;
  useEffect(() => {
    if (show) ref.current?.focus();
  }, [submission, show]);
  if (!show) return null;
  return (
    <div ref={ref} tabIndex={-1} role="group" aria-labelledby="error-summary-title" className="error-summary" data-error-summary>
      <h2 id="error-summary-title" className="error-summary-title">There is a problem</h2>
      {message && <p>{message}</p>}
      {entries.length > 0 && (
        <ul>
          {entries.map(([field, text]) => <li key={field}><a href={`#f-${field}`}>{text}</a></li>)}
        </ul>
      )}
    </div>
  );
}
