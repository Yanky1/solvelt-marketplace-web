import { Form, Link, useLocation, useSearchParams } from "react-router";
import { CsrfField, useRootData } from "./Shell";
import { Button } from "./ui/form";
import { QUESTION_MAX } from "~/lib/reviews";

const NOTICES: Record<string, string> = {
  asked: "Thanks. We sent your question to the seller. If they answer it, the answer appears on this page.", invalid: "We couldn't use that question. Please leave out phone numbers, email addresses and links.",
  limit: "You have asked a lot of questions today. Please try again tomorrow.", gone: "That item is not available any more.", retry: "Something went wrong. Please try again.",
};

/** "Ask the seller a question" under the product's Q&A: a plain form post to `/questions`; a guest is asked to sign in first. */
export function AskQuestion({ listingId }: { listingId: string }) {
  const root = useRootData();
  const location = useLocation();
  const [params] = useSearchParams();
  const notice = NOTICES[params.get("qnotice") ?? ""];
  const back = (() => { const u = new URLSearchParams(location.search); u.delete("rnotice"); u.delete("qnotice"); const q = u.toString(); return location.pathname + (q ? `?${q}` : ""); })();
  return (
    <section id="questions" aria-labelledby="ask-h" className="pdp-section stack">
      <h2 id="ask-h">Ask the seller</h2>
      {notice && <p role="status" className="card">{notice}</p>}
      {root?.user ? (
        <Form method="post" action="/questions" className="stack">
          <CsrfField /><input type="hidden" name="listingId" value={listingId} /><input type="hidden" name="return" value={back} />
          <div className="field">
            <label htmlFor="q-text">Your question</label>
            <textarea id="q-text" name="text" className="input" rows={3} required maxLength={QUESTION_MAX} aria-describedby="q-hint" />
            <span id="q-hint" className="field-hint">Sellers answer here, so please leave out phone numbers, email addresses and links. <Link to="/account/questions">Your questions</Link></span>
          </div>
          <Button type="submit" variant="secondary">Send question</Button>
        </Form>
      ) : (
        <p><Link to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in</Link> to ask the seller a question.</p>
      )}
    </section>
  );
}
