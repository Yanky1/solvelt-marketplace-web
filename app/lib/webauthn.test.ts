import { describe, expect, it } from "vitest";
import { b64urlToBytes, bytesToB64url, serializeCredential, toCreationOptions, toRequestOptions } from "./webauthn";

describe("base64url", () => {
  it("round-trips arbitrary bytes, with no padding or unsafe characters", () => {
    for (const len of [0, 1, 2, 3, 31, 32, 255]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 250) % 256);
      const s = bytesToB64url(bytes);
      expect(s).not.toMatch(/[+/=]/);
      expect([...b64urlToBytes(s)]).toEqual([...bytes]);
    }
  });
  it("decodes the standard test vector", () => { expect([...b64urlToBytes("-_8")]).toEqual([251, 255]); });
});

describe("option conversion", () => {
  const challenge = bytesToB64url(Uint8Array.of(1, 2, 3));
  it("decodes challenge, user id and credential ids in creation options", () => {
    const o = toCreationOptions({ challenge, rp: { name: "S" }, user: { id: bytesToB64url(Uint8Array.of(9)), name: "n", displayName: "d" }, pubKeyCredParams: [], excludeCredentials: [{ id: bytesToB64url(Uint8Array.of(7, 7)), type: "public-key" }] });
    expect([...new Uint8Array(o.challenge as ArrayBuffer)]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(o.user.id as ArrayBuffer)]).toEqual([9]);
    expect([...new Uint8Array(o.excludeCredentials![0]!.id as ArrayBuffer)]).toEqual([7, 7]);
  });
  it("decodes challenge and allowed credentials in request options (empty allow list = discoverable)", () => {
    expect(toRequestOptions({ challenge }).allowCredentials).toBeUndefined();
    const o = toRequestOptions({ challenge, allowCredentials: [{ id: bytesToB64url(Uint8Array.of(5)), type: "public-key" }] });
    expect([...new Uint8Array(o.allowCredentials![0]!.id as ArrayBuffer)]).toEqual([5]);
  });
});

describe("serializeCredential", () => {
  const buf = (...n: number[]) => Uint8Array.from(n).buffer;
  it("serialises a registration response", () => {
    const cred = { id: "abc", rawId: buf(1), type: "public-key", response: { clientDataJSON: buf(2), attestationObject: buf(3), getTransports: () => ["internal"] }, getClientExtensionResults: () => ({}) } as unknown as PublicKeyCredential;
    const j = serializeCredential(cred) as { response: Record<string, unknown>; rawId: string };
    expect(j.rawId).toBe(bytesToB64url(buf(1)));
    expect(Object.keys(j.response).sort()).toEqual(["attestationObject", "clientDataJSON", "transports"]);
  });
  it("serialises an assertion response including the user handle", () => {
    const cred = { id: "abc", rawId: buf(1), type: "public-key", response: { clientDataJSON: buf(2), authenticatorData: buf(3), signature: buf(4), userHandle: buf(5) }, getClientExtensionResults: () => ({}) } as unknown as PublicKeyCredential;
    const j = serializeCredential(cred) as { response: Record<string, unknown> };
    expect(Object.keys(j.response).sort()).toEqual(["authenticatorData", "clientDataJSON", "signature", "userHandle"]);
  });
});
