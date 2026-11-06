import { useEffect } from "react";
import { Form, Link, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/account.messages.$id";
import { AccountNav } from "~/components/AccountNav";
import { FormMessage } from "~/components/AuthForm";
import { MessageCompose } from "~/components/MessageCompose";
import { CsrfField } from "~/components/Shell";
import { Badge, Breadcrumb, Card } from "~/components/ui/display";
import { Button } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { trySend } from "~/lib/message-send.server";
import { DELIVERY_STATE, formatSize } from "~/lib/messages";
import { formatDate } from "~/lib/orders";
import { isSafeId } from "~/lib/passkey.server";
import { cleanField, str } from "~/lib/validation";

export function meta() {
  return [{ title: "Conversation | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(params.id)) throw new Response("Not found", { status: 404, headers: privateHeaders });
  const q = new URL(request.url).searchParams;
  try {
    return { view: await api.thread(ctx, params.id, q.get("before") ?? undefined), reported: q.has("reported") };
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(params.id)) throw new Response("Not found", { status: 404, headers: privateHeaders });
  const intent = str(form, "intent");
  try {
    if (intent === "read") { await api.markThreadRead(ctx, params.id); return redirect(`/account/messages/${encodeURIComponent(params.id)}`, { headers: privateHeaders }); }
    if (intent === "report") {
      const id = str(form, "messageId"), reason = cleanField(form, "reason").slice(0, 200);
      if (!isSafeId(id)) throw new Response("Bad request", { status: 400, headers: privateHeaders });
      if (!reason) return formError({ reportFor: id, reportError: "Say what is wrong." }, 422);
      await api.reportMessage(ctx, id, { reason, note: cleanField(form, "note").slice(0, 1000) });
      return redirect(`/account/messages/${encodeURIComponent(params.id)}?reported=1`, { headers: privateHeaders });
    }
    if (intent !== "send") throw new Response("Bad request", { status: 400, headers: privateHeaders });
    const r = await trySend(ctx, { threadId: params.id, text: str(form, "text"), acknowledgeWarning: form.get("acknowledgeWarning") === "on" });
    if (r.ok) return redirect(`/account/messages/${encodeURIComponent(params.id)}`, { headers: privateHeaders });
    return formError({ text: r.failure.text, message: r.failure.message, fieldErrors: r.failure.fieldErrors, warning: r.failure.warning }, r.failure.status);
  } catch (e) {
    if (e instanceof ApiError && e.status === 429 && intent === "report") return formError({ message: "You are sending too quickly. Please wait a minute." }, 429);
    return failAccount(e, request);
  }
}

export default function Thread({ loaderData, actionData }: Route.ComponentProps) {
  const { view, reported } = loaderData;
  const unread = view.messages.some((m) => m.direction === "seller" && !m.read);
  const fetcher = useFetcher();
  // Opening the conversation marks the seller's messages read (the portal gets read receipts). With JavaScript this happens by itself; without it the button below does it.
  useEffect(() => {
    if (unread && fetcher.state === "idle" && !fetcher.data) void fetcher.submit({ intent: "read", csrf: (document.querySelector('input[name="csrf"]') as HTMLInputElement | null)?.value ?? "" }, { method: "post" });
  }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = actionData as { text?: string; message?: string | null; fieldErrors?: Record<string, string>; warning?: string[] | null; reportFor?: string; reportError?: string } | undefined;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <Breadcrumb items={[{ label: "Messages", to: "/account/messages" }, { label: view.thread.sellerName ?? "Seller" }]} />
      <h2>{view.thread.sellerName ?? "Seller"}: {view.thread.subject}</h2>
      {view.thread.marketplaceBookingId && <p><Link to={`/bookings/${encodeURIComponent(view.thread.marketplaceBookingId)}`}>View this booking</Link></p>}
      {reported && <FormMessage kind="ok">Thank you. We sent your report to our moderators.</FormMessage>}
      {view.older && <Link className="btn btn-secondary" to={`?before=${encodeURIComponent(view.older)}`}>Earlier messages</Link>}
      <ol className="stack u-list-style-none-padding-0" aria-label="Messages">
        {view.messages.map((m) => (
          <li key={m.id} className={m.direction === "buyer" ? "u-msg u-msg-buyer" : "u-msg u-msg-seller"}>
            <Card className="stack">
              <div className="row u-justify-content-space-between">
                <strong>{m.direction === "buyer" ? "You" : view.thread.sellerName ?? "Seller"}</strong>
                <span className="muted">{formatDate(m.sentAt, true)}</span>
              </div>
              {m.hidden ? <p className="muted u-margin-0-white-space-pre-wrap-overflow-wrap-anywhere"><em>This message was removed by our moderators.</em></p> : <p>{m.text}</p>}
              {m.attachments.length > 0 && (
                <ul className="u-margin-0">
                  {m.attachments.map((f) => (
                    <li key={f.id}>
                      {f.available ? <a href={`/account/messages/attachments/${encodeURIComponent(f.id)}`} download>{f.fileName} <span className="muted">({formatSize(f.size)})</span></a>
                        : <span className="muted">{f.fileName} (removed for your safety or no longer available)</span>}
                    </li>
                  ))}
                </ul>
              )}
              {m.direction === "buyer" && m.status !== "sent" && <Badge tone={m.status === "failed" ? "err" : "neutral"}>{DELIVERY_STATE[m.status] ?? m.status}</Badge>}
              {m.direction === "seller" && !m.hidden && (
                m.reported ? <span className="muted">You reported this message.</span> : (
                  <details open={a?.reportFor === m.id}>
                    <summary>Report this message</summary>
                    <Form method="post" className="stack" noValidate>
                      <CsrfField /><input type="hidden" name="intent" value="report" /><input type="hidden" name="messageId" value={m.id} />
                      <div className="field">
                        <label htmlFor={`reason-${m.id}`}>What is wrong?</label>
                        <input id={`reason-${m.id}`} name="reason" className="input" maxLength={200} aria-invalid={a?.reportFor === m.id && a.reportError ? true : undefined} required />
                        {a?.reportFor === m.id && a.reportError && <span className="field-error">{a.reportError}</span>}
                      </div>
                      <Button type="submit" variant="secondary">Send report</Button>
                    </Form>
                  </details>
                )
              )}
            </Card>
          </li>
        ))}
      </ol>
      {unread && (
        <Form method="post"><CsrfField /><input type="hidden" name="intent" value="read" /><noscript><Button type="submit" variant="secondary">Mark as read</Button></noscript></Form>
      )}
      <h3>Reply</h3>
      <MessageCompose state={a?.reportFor ? undefined : a} hidden={{}} label="Your reply" submit="Send reply" />
    </div>
  );
}
