import { useState } from "react";
import { REVIEW_MAX } from "~/lib/reviews";

/** Five radio buttons that read as a star rating (the choice is text for a screen reader: "3 stars"), and the text with its own count. Shared by the write and the edit page. */
export function RatingField({ defaultValue, error }: { defaultValue?: number | undefined; error?: string | undefined }) {
  return (
    <fieldset className="stack" aria-describedby={error ? "rating-error" : undefined}>
      <legend>Your rating</legend>
      <div className="row">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="check">
            <input type="radio" name="rating" value={n} defaultChecked={defaultValue === n} required />
            <span>{n} {n === 1 ? "star" : "stars"}</span>
          </label>
        ))}
      </div>
      {error && <span id="rating-error" className="field-error">{error}</span>}
    </fieldset>
  );
}

export function ReviewTextField({ defaultValue, error }: { defaultValue?: string | undefined; error?: string | undefined }) {
  const [len, setLen] = useState([...(defaultValue ?? "")].length);
  return (
    <div className="field">
      <label htmlFor="f-text">Your review</label>
      <textarea id="f-text" name="text" className="input" rows={6} defaultValue={defaultValue} required maxLength={REVIEW_MAX} aria-invalid={error ? true : undefined} aria-describedby={`f-text-hint${error ? " f-text-error" : ""}`}
        onChange={(e) => setLen([...e.currentTarget.value].length)} />
      <span id="f-text-hint" className="field-hint">What was it like? Please leave out phone numbers, email addresses and links. {len} of {REVIEW_MAX} characters.</span>
      {error && <span id="f-text-error" className="field-error">{error}</span>}
    </div>
  );
}
