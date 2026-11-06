import { describe, expect, it } from "vitest";
import { action } from "../routes/account.reviews.$id";
import { UPLOAD_BODY_MAX, refuseOversizeBody } from "./body-size.server";

/** Found bug (decision M6W-05): the review photo upload called request.formData() before its size check and before assertCsrf. */
const MB = 1024 * 1024;
const fake = (contentLength: string | null, onFormData: () => void) => ({
  method: "POST", url: "http://localhost/account/reviews/abc", headers: new Headers(contentLength === null ? {} : { "content-length": contentLength }),
  formData: async () => { onFormData(); throw new Error("formData was called"); },
}) as unknown as Request;

describe("refuseOversizeBody", () => {
  it("throws a 413 for a declared size over the cap and reads nothing", () => {
    let read = false;
    let thrown: unknown;
    try { refuseOversizeBody(fake(String(UPLOAD_BODY_MAX + 1), () => { read = true; }), UPLOAD_BODY_MAX); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(413);
    expect((thrown as Response).headers.get("cache-control")).toBe("no-store");
    expect(read).toBe(false);
  });
  it("lets a body at or under the cap, no declared size, or a malformed one through (the server's streaming cap covers the last two)", () => {
    for (const v of [String(UPLOAD_BODY_MAX), "0", "1000", null, "abc", "-5", "1e9"]) expect(() => refuseOversizeBody(fake(v, () => {}), UPLOAD_BODY_MAX), String(v)).not.toThrow();
  });
  it("keeps the upload cap just above the 5 MB picture, with room for the multipart framing", () => {
    expect(UPLOAD_BODY_MAX).toBeGreaterThan(5 * MB);
    expect(UPLOAD_BODY_MAX).toBeLessThanOrEqual(8 * MB);
  });
});

describe("the review photo action", () => {
  it("answers 413 for an oversize declared body BEFORE it reads the body and before the csrf check", async () => {
    let read = false;
    const result = action({ params: { id: "abc" }, request: fake(String(200 * MB), () => { read = true; }), context: {} } as never);
    await expect(result).rejects.toSatisfy((r: unknown) => r instanceof Response && r.status === 413);
    expect(read).toBe(false);                                                           // formData() was never called: a 200 MB anonymous POST is not read into memory
  });
  it("still reads the body of a normal-sized request (the old path)", async () => {
    let read = false;
    await expect(action({ params: { id: "abc" }, request: fake("1000", () => { read = true; }), context: {} } as never)).rejects.toThrow("formData was called");
    expect(read).toBe(true);
  });
});
