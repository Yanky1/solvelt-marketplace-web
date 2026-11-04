import type { ReactNode } from "react";
import { Card } from "./ui/display";

export function AuthPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ maxWidth: 480, marginInline: "auto" }}>
      <Card className="stack">
        <h1 style={{ fontSize: "var(--fs-xl)" }}>{title}</h1>
        {intro && <p className="muted">{intro}</p>}
        {children}
      </Card>
    </div>
  );
}

/** Form-level message, announced to screen readers. */
export function FormMessage({ kind, children }: { kind: "error" | "ok"; children: ReactNode }) {
  return (
    <p role={kind === "error" ? "alert" : "status"} className={kind === "error" ? "field-error" : "badge badge-ok"} style={kind === "ok" ? { borderRadius: "var(--r-ctl)", padding: "var(--s1) var(--s2)" } : undefined}>
      {children}
    </p>
  );
}
