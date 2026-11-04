import { Link } from "react-router";

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Solvelt Market, home">
      <span className="logo-mark" aria-hidden="true">S</span>
      <span className="logo-word" aria-hidden="true">Solvelt<small>Market</small></span>
    </Link>
  );
}
