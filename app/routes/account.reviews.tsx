import { Link } from "react-router";
import type { Route } from "./+types/account.reviews";
import { AccountNav } from "~/components/AccountNav";
import { Badge, Card, EmptyState, RatingStars } from "~/components/ui/display";
import { api } from "~/lib/api-client.server";
import { failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { listingPath } from "~/lib/urls";

export function meta() {
  return [{ title: "Your reviews | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  try {
    return { reviews: await api.myReviews(ctx), saved: new URL(request.url).searchParams.has("saved") };
  } catch (e) {
    return failAccount(e, request);
  }
}

const STATUS: Record<string, string> = { published: "Shown", hidden: "Hidden by our moderators", removed: "Removed by our moderators" };

export default function MyReviews({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <h2>Your reviews</h2>
      <p className="muted">You can review what you have received or attended, from its product page. A review can be changed for 30 days.</p>
      {loaderData.reviews.length === 0 ? (
        <EmptyState title="No reviews yet">After something arrives, tell other buyers what it was like.</EmptyState>
      ) : (
        <ul className="stack u-list-style-none-padding-0">
          {loaderData.reviews.map(({ review: r, listing }) => (
            <li key={r.id}>
              <Card className="stack">
                <div className="row u-justify-content-space-between">
                  <strong>{listing ? <Link to={listingPath(listing.slug)}>{listing.title}</Link> : "An item that is no longer listed"}</strong>
                  {r.status && r.status !== "published" && <Badge tone="err">{STATUS[r.status] ?? r.status}</Badge>}
                </div>
                <RatingStars value={r.rating} />
                {r.text && <p className="u-white-space-pre-line-margin-0">{r.text}</p>}
                {r.moderationNote && <p className="muted">From our moderators: {r.moderationNote}</p>}
                {r.canEdit && <p><Link className="btn btn-secondary" to={`/account/reviews/${encodeURIComponent(r.id)}`} aria-label={`Change your review of ${listing?.title ?? "this item"}`}>Change or add photos</Link></p>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
