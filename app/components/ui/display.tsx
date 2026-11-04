import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["card", className].filter(Boolean).join(" ")} {...rest} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "gold" | "ok" | "err"; children: ReactNode }) {
  return <span className={tone === "neutral" ? "badge" : `badge badge-${tone}`}>{children}</span>;
}

export function formatMoney(cents: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function Price({ cents, wasCents, currency = "USD" }: { cents: number; wasCents?: number | undefined; currency?: string }) {
  return (
    <span>
      <span className="price">{formatMoney(cents, currency)}</span>
      {wasCents && wasCents > cents && (
        <>
          <span className="sr-only"> was </span>
          <span className="price-was">{formatMoney(wasCents, currency)}</span>
        </>
      )}
    </span>
  );
}

/** Display-only rating. Exposes the value as text, so the glyphs are decorative. */
export function RatingStars({ value, count }: { value: number; count?: number | undefined }) {
  const v = Math.max(0, Math.min(5, value));
  const full = Math.round(v);
  return (
    <span className="stars">
      <span aria-hidden="true">{"★".repeat(full)}{"☆".repeat(5 - full)}</span>
      <span className="sr-only">Rated {v.toFixed(1)} out of 5</span>
      {count !== undefined && <span className="muted">({count})</span>}
    </span>
  );
}

export function Skeleton({ width = "100%", height = 16 }: { width?: number | string; height?: number | string }) {
  return <span className="skeleton" aria-hidden="true" style={{ width, height }} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export interface Crumb { label: string; to?: string }
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <ol>
        {items.map((c, i) => (
          <li key={i}>{c.to && i < items.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current={i === items.length - 1 ? "page" : undefined}>{c.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

export function Pagination({ page, pageCount, hrefFor }: { page: number; pageCount: number; hrefFor: (page: number) => string }) {
  if (pageCount <= 1) return null;
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1);
  return (
    <nav className="pagination" aria-label="Pagination">
      <ul>
        {page > 1 && <li><Link to={hrefFor(page - 1)} rel="prev">Previous</Link></li>}
        {pages.map((p, i) => (
          <li key={p}>
            {i > 0 && p - (pages[i - 1] ?? 0) > 1 && <span aria-hidden="true">…</span>}
            {p === page ? <span aria-current="page">{p}</span> : <Link to={hrefFor(p)} aria-label={`Page ${p}`}>{p}</Link>}
          </li>
        ))}
        {page < pageCount && <li><Link to={hrefFor(page + 1)} rel="next">Next</Link></li>}
      </ul>
    </nav>
  );
}
