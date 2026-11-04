import { LinkButton } from "~/components/ui/form";
import { EmptyState } from "~/components/ui/display";

export function meta() {
  return [
    { title: "Solvelt Market: products and services from independent sellers" },
    { name: "description", content: "Shop products and book services from independent sellers on Solvelt Market." },
  ];
}

export default function Home() {
  return (
    <div className="stack">
      <section className="hero">
        <h1>Shop independent sellers, with confidence</h1>
        <p>Products and services from trusted sellers, with kosher-aware filters and one simple checkout.</p>
        <LinkButton to="/categories" className="btn-gold">Browse categories</LinkButton>
      </section>
      <section aria-labelledby="featured">
        <h2 id="featured">Featured</h2>
        <EmptyState title="Listings are on their way">The catalog connects in the next release.</EmptyState>
      </section>
    </div>
  );
}
