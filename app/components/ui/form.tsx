import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const cls = (...p: (string | false | undefined)[]) => p.filter(Boolean).join(" ");

export function Button({ variant = "primary", className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={cls("btn", `btn-${variant}`, className)} {...rest} />;
}

export function LinkButton({ variant = "primary", className, ...rest }: LinkProps & { variant?: Variant }) {
  return <Link className={cls("btn", `btn-${variant}`, className)} {...rest} />;
}

interface FieldShell { label: string; error?: string | undefined; hint?: string | undefined }

function useFieldIds(id?: string) {
  const auto = useId();
  const base = id ?? auto;
  return { id: base, hintId: `${base}-hint`, errorId: `${base}-error` };
}

function Shell({ ids, label, error, hint, children }: FieldShell & { ids: ReturnType<typeof useFieldIds>; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={ids.id}>{label}</label>
      {children}
      {hint && <span id={ids.hintId} className="field-hint">{hint}</span>}
      {error && <span id={ids.errorId} className="field-error" role="alert">{error}</span>}
    </div>
  );
}

const describedBy = (ids: ReturnType<typeof useFieldIds>, f: FieldShell) =>
  [f.hint && ids.hintId, f.error && ids.errorId].filter(Boolean).join(" ") || undefined;

export function Input({ label, error, hint, id, className, ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const ids = useFieldIds(id);
  return (
    <Shell ids={ids} label={label} error={error} hint={hint}>
      <input id={ids.id} className={cls("input", className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy(ids, { label, error, hint })} {...rest} />
    </Shell>
  );
}

export function Select({ label, error, hint, id, className, children, ...rest }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const ids = useFieldIds(id);
  return (
    <Shell ids={ids} label={label} error={error} hint={hint}>
      <select id={ids.id} className={cls("select", className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy(ids, { label, error, hint })} {...rest}>{children}</select>
    </Shell>
  );
}

export function Checkbox({ label, error, id, ...rest }: { label: ReactNode; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const ids = useFieldIds(id);
  return (
    <div className="field">
      <label className="check" htmlFor={ids.id}>
        <input id={ids.id} type="checkbox" aria-invalid={error ? true : undefined} aria-describedby={error ? ids.errorId : undefined} {...rest} />
        <span>{label}</span>
      </label>
      {error && <span id={ids.errorId} className="field-error" role="alert">{error}</span>}
    </div>
  );
}
