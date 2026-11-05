import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_REFUSED_TEXT } from "./demo";
import { trySend } from "./message-send.server";

vi.mock("./api-client.server", () => {
  class ApiError extends Error { constructor(public status: number, public code: string, message: string, public fieldErrors?: Record<string, string>) { super(message); } }
  return { ApiError, api: { sendMessage: vi.fn() } };
});
import { ApiError, api } from "./api-client.server";

const ctx = {} as never;
const send = () => trySend(ctx, { text: "Can you hold it for me?" } as never);
const failWith = (status: number, code: string) => vi.mocked(api.sendMessage).mockRejectedValue(new ApiError(status, code, "x"));

describe("trySend on a refused or closed conversation (M9)", () => {
  beforeEach(() => { vi.mocked(api.sendMessage).mockReset(); });

  it("says a demo conversation sends nothing, not that it is closed", async () => {
    failWith(409, "demo_data");
    const r = await send();
    expect(r).toMatchObject({ ok: false, failure: { message: DEMO_REFUSED_TEXT, status: 409, text: "Can you hold it for me?" } });
  });
  it("still says a real closed conversation is closed", async () => {
    failWith(409, "thread_closed");
    expect(await send()).toMatchObject({ ok: false, failure: { message: "This conversation has been closed.", status: 409 } });
  });
  it("keeps the contact-details warning for its own code", async () => {
    vi.mocked(api.sendMessage).mockRejectedValue(new ApiError(409, "contact_details_warning", "x", { email: "x" }));
    expect(await send()).toMatchObject({ ok: false, failure: { warning: ["email"], message: null } });
  });
});
