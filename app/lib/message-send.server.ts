import type { ApiRequestContext } from "./api.server";
import { ApiError, api, type SendMessageInput } from "./api-client.server";
import { DEMO_REFUSED_CODE, DEMO_REFUSED_TEXT } from "./demo";
import { MAX_TEXT } from "./messages";

export interface SendFailure { text: string; message: string | null; fieldErrors: Record<string, string>; warning: string[] | null; status: number }

/** Sends a buyer message and maps every way it can fail to something a page can show. A 401/404 is rethrown for `failAccount`. */
export async function trySend(ctx: ApiRequestContext, input: SendMessageInput): Promise<{ ok: true; threadId: string } | { ok: false; failure: SendFailure }> {
  const text = input.text.trim();
  if (!text) return { ok: false, failure: { text: input.text, message: null, fieldErrors: { text: "Write a message." }, warning: null, status: 422 } };
  if (text.length > MAX_TEXT) return { ok: false, failure: { text: input.text, message: null, fieldErrors: { text: `Keep the message under ${MAX_TEXT} characters.` }, warning: null, status: 422 } };
  try {
    const r = await api.sendMessage(ctx, { ...input, text });
    return { ok: true, threadId: r.threadId };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === "contact_details_warning")
      return { ok: false, failure: { text: input.text, message: null, fieldErrors: {}, warning: Object.keys(e.fieldErrors ?? {}).slice(0, 6), status: 409 } };
    if (e instanceof ApiError && e.status === 409 && e.code === DEMO_REFUSED_CODE) return { ok: false, failure: { text: input.text, message: DEMO_REFUSED_TEXT, fieldErrors: {}, warning: null, status: 409 } };   // test mode: a demo conversation sends nothing
    if (e instanceof ApiError && e.status === 409) return { ok: false, failure: { text: input.text, message: "This conversation has been closed.", fieldErrors: {}, warning: null, status: 409 } };
    if (e instanceof ApiError && e.status === 422) return { ok: false, failure: { text: input.text, message: null, fieldErrors: { text: "Check your message and try again." }, warning: null, status: 422 } };
    if (e instanceof ApiError && e.status === 429) return { ok: false, failure: { text: input.text, message: "You are sending messages too quickly. Please wait a minute.", fieldErrors: {}, warning: null, status: 429 } };
    if (e instanceof ApiError && e.status !== 401 && e.status !== 404) return { ok: false, failure: { text: input.text, message: "We could not send your message right now. Please try again.", fieldErrors: {}, warning: null, status: 503 } };
    throw e;
  }
}
