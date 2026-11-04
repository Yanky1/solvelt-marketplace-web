import { Form, useNavigation } from "react-router";
import { ErrorSummary } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Checkbox } from "~/components/ui/form";
import { MAX_TEXT, warningText } from "~/lib/messages";

export interface ComposeState { text?: string; message?: string | null; fieldErrors?: Record<string, string>; warning?: string[] | null }

/** The write box. After a contact-details warning it keeps the text and asks the buyer to confirm (a checkbox that is sent as `acknowledgeWarning`). Works without JavaScript. */
export function MessageCompose({ state, hidden, label = "Your message", submit = "Send message" }: { state: ComposeState | undefined; hidden: Record<string, string>; label?: string; submit?: string }) {
  const busy = useNavigation().state !== "idle";
  const warn = state?.warning && state.warning.length > 0 ? state.warning : null;
  return (
    <Form method="post" className="stack" noValidate>
      <CsrfField /><input type="hidden" name="intent" value="send" />
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <ErrorSummary submission={state} message={state?.message} errors={state?.fieldErrors} />
      <div className="field">
        <label htmlFor="f-text">{label}</label>
        <textarea id="f-text" name="text" className="input" rows={4} maxLength={MAX_TEXT} defaultValue={state?.text ?? ""} aria-invalid={state?.fieldErrors?.text ? true : undefined} aria-describedby={state?.fieldErrors?.text ? "f-text-error" : undefined} required />
        {state?.fieldErrors?.text && <span id="f-text-error" className="field-error">{state.fieldErrors.text}</span>}
      </div>
      {warn && (
        <div role="alert" className="stack">
          <p><strong>Your message seems to include {warningText(warn)}.</strong> Keeping payment and contact details on Solvelt protects you: orders paid or arranged elsewhere are not covered.</p>
          <Checkbox name="acknowledgeWarning" label="Send it anyway" />
        </div>
      )}
      <Button type="submit" disabled={busy}>{busy ? "Sending…" : submit}</Button>
    </Form>
  );
}
