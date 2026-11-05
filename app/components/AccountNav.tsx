import { NavLink } from "react-router";

const LINKS = [
  { to: "/account", label: "Overview", end: true },
  { to: "/account/orders", label: "Orders" },
  { to: "/account/bookings", label: "Bookings" },
  { to: "/account/messages", label: "Messages" },
  { to: "/account/notifications", label: "Notifications" },
  { to: "/account/profile", label: "Profile" },
  { to: "/account/addresses", label: "Addresses" },
  { to: "/account/passkeys", label: "Passkeys" },
];

export function AccountNav() {
  return (
    <nav aria-label="Account" className="row" style={{ marginBottom: "var(--s3)" }}>
      {LINKS.map((l) => (
        <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `btn ${isActive ? "btn-primary" : "btn-secondary"}`}>
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}
