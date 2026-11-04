import { Link } from "react-router";

export function Logo() {
  return (
    // The name is the visible words plus "home": an accessible name must contain what the eye reads (WCAG 2.5.3), so no aria-label that rewrites it.
    <Link to="/" className="logo">
      <span className="logo-mark" aria-hidden="true">S</span>
      <span className="logo-word">Solvelt <small>Market</small><span className="sr-only">, home</span></span>
    </Link>
  );
}
