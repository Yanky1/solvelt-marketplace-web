import { Form, Link, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/sign-in.phone";
import { AuthPage, ErrorSummary, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { afterSignIn } from "~/lib/cart.server";
import { apiCtx, assertCsrf, currentUser, formError, revokePreviousSession, signInHeaders } from "~/lib/auth.server";
import { safeNext } from "~/lib/csrf.server";
import { retryAfterHeader, tooManyMessage } from "~/lib/rate-limit";
import { phoneDigits, str, textablePhone, type FieldErrors } from "~/lib/validation";

/**
 * Sign in with a text message (DESIGN W3-02; API W3-02): for an account made BY PHONE, which has no email and no password. Two steps on one address: the number, then the six-digit code.
 * The API texts a code to ANY valid number, so the first step answers the same whether or not the number has an account; only someone who types the right code can learn that it has none.
 * The challenge id travels in a hidden field (it is not a secret: the code is); the number is kept only to show its last four digits and to ask again.
 */
export function meta() {
  return [{ title: "Sign in with a text message | Solvelt" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user } = await currentUser(request, context);
  if (user) throw redirect(safeNext(new URL(request.url).searchParams.get("next"), "/account"));
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Step = "phone" | "code";
interface ActionData { step: Step; phone: string; challengeId?: string; message: string | null; notice?: string; fieldErrors: FieldErrors }
const last4 = (phone: string) => phoneDigits(phone).slice(-4);

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const ctx = apiCtx(request, context, null);
  const intent = str(form, "intent");
  const phone = str(form, "phone").trim().slice(0, 40);
  const back = (body: Partial<ActionData>, status: number, headers: Record<string, string> = {}) =>
    formError<ActionData>({ step: "phone", phone, message: null, fieldErrors: {}, ...body }, status, headers);

  if (intent === "start" || intent === "resend") {
    if (!textablePhone(phone)) return back({ fieldErrors: { phone: "Enter your phone number, for example 718 555 0123." } }, 422);
    try {
      const { challengeId } = await api.phoneStart(ctx, phone);
      return formError<ActionData>({ step: "code", phone, challengeId, message: null, notice: intent === "resend" ? "We sent a new code." : undefined, fieldErrors: {} }, 200);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 422) return back({ fieldErrors: { phone: "Enter your phone number, for example 718 555 0123." } }, 422);
        if (e.status === 429) return back({ message: tooManyMessage(e.retryAfter) }, 429, retryAfterHeader(e.retryAfter));
        if (e.code === "phone_sign_in_unavailable") return back({ message: "Signing in with a text message is not available right now. Please sign in with your email or try again later." }, 503);
      }
      return back({ message: "We could not send the text message right now. Please try again in a moment." }, 503);
    }
  }

  // intent "verify"
  const challengeId = str(form, "challengeId");
  const code = str(form, "code").replace(/\s+/g, "");
  if (!UUID.test(challengeId)) return back({ message: "Please ask for a new code." }, 400);
  if (!/^\d{6}$/.test(code)) return formError<ActionData>({ step: "code", phone, challengeId, message: null, fieldErrors: { code: "Enter the six-digit code from the text message." } }, 422);
  try {
    const { token } = await api.phoneVerify(ctx, { challengeId, code });
    await revokePreviousSession(request, context);
    const cart = await afterSignIn(request, context, token);
    return redirect(safeNext(str(form, "next"), "/account"), { headers: signInHeaders(token, cart) });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) return formError<ActionData>({ step: "code", phone, challengeId, message: null, fieldErrors: { code: "That code is not correct. Check the text message and try again." } }, 401);
      if (e.status === 400) return back({ message: "That code has expired or was tried too many times. Ask for a new one." }, 400);
      if (e.status === 404) return back({ message: "No account signs in with this number on the website. If your account has a password, sign in with your email. You can also create an account." }, 404);
      if (e.status === 429) return formError<ActionData>({ step: "code", phone, challengeId, message: tooManyMessage(e.retryAfter), fieldErrors: {} }, 429, retryAfterHeader(e.retryAfter));
    }
    return formError<ActionData>({ step: "code", phone, challengeId, message: "We could not check the code right now. Please try again.", fieldErrors: {} }, 503);
  }
}

export default function SignInWithPhone() {
  const a = useActionData<typeof action>() as ActionData | undefined;
  const busy = useNavigation().state !== "idle";
  const [params] = useSearchParams();
  const next = params.get("next") ?? "";
  const step: Step = a?.step ?? "phone";
  return (
    <AuthPage title="Sign in with a text message" intro={<>For accounts made on a phone call with Solvelt. Have a password? <Link to={`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in with your email</Link>.</>}>
      <ErrorSummary submission={a} message={a?.message} errors={a?.fieldErrors} />
      {a?.notice && <FormMessage kind="ok">{a.notice}</FormMessage>}
      {step === "phone" ? (
        <Form method="post" className="stack" noValidate>
          <CsrfField />
          <input type="hidden" name="next" value={next} />
          <Input label="Phone number" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={a?.phone ?? ""} error={a?.fieldErrors?.phone} hint="The number you use to call Solvelt. We text it a six-digit code." required />
          <Button type="submit" name="intent" value="start" disabled={busy}>{busy ? "Sending…" : "Text me a code"}</Button>
        </Form>
      ) : (
        <div className="stack">
          <Form method="post" className="stack" noValidate>
            <CsrfField />
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="phone" value={a?.phone ?? ""} />
            <input type="hidden" name="challengeId" value={a?.challengeId ?? ""} />
            <p data-testid="code-sent">If an account can use it, we texted a code to the number ending in {last4(a?.phone ?? "")}. It works for 10 minutes.</p>
            <Input label="Six-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} error={a?.fieldErrors?.code} required />
            <Button type="submit" name="intent" value="verify" disabled={busy}>{busy ? "Checking…" : "Sign in"}</Button>
          </Form>
          <Form method="post" className="stack" noValidate>
            <CsrfField />
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="phone" value={a?.phone ?? ""} />
            <Button type="submit" name="intent" value="resend" variant="secondary" disabled={busy}>Send a new code</Button>
          </Form>
        </div>
      )}
    </AuthPage>
  );
}
