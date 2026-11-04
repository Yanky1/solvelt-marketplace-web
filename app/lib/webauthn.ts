import { useSyncExternalStore } from "react";

/**
 * WebAuthn JSON <-> binary helpers (native API only, no library). Isomorphic on purpose: NOT named *.client.ts, which React Router
 * strips from the server bundle (the passkey hook runs during SSR). Browser APIs are only touched inside handlers.
 */

export function b64urlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function bytesToB64url(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface Descriptor { id: string; type: "public-key"; transports?: AuthenticatorTransport[] }

export function toCreationOptions(json: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const o = json as unknown as Omit<PublicKeyCredentialCreationOptions, "challenge" | "user" | "excludeCredentials"> & {
    challenge: string; user: { id: string; name: string; displayName: string }; excludeCredentials?: Descriptor[];
  };
  return {
    ...o,
    challenge: b64urlToBytes(o.challenge).buffer as ArrayBuffer,
    user: { ...o.user, id: b64urlToBytes(o.user.id).buffer as ArrayBuffer },
    excludeCredentials: o.excludeCredentials?.map((c) => ({ ...c, id: b64urlToBytes(c.id).buffer as ArrayBuffer })),
  };
}

export function toRequestOptions(json: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const o = json as unknown as Omit<PublicKeyCredentialRequestOptions, "challenge" | "allowCredentials"> & { challenge: string; allowCredentials?: Descriptor[] };
  return {
    ...o,
    challenge: b64urlToBytes(o.challenge).buffer as ArrayBuffer,
    allowCredentials: o.allowCredentials?.map((c) => ({ ...c, id: b64urlToBytes(c.id).buffer as ArrayBuffer })),
  };
}

/** The JSON the API receives (the standard RegistrationResponseJSON / AuthenticationResponseJSON shapes). */
export function serializeCredential(cred: PublicKeyCredential): Record<string, unknown> {
  const r = cred.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const response: Record<string, unknown> = { clientDataJSON: bytesToB64url(r.clientDataJSON) };
  if ("attestationObject" in r && r.attestationObject) {
    response.attestationObject = bytesToB64url(r.attestationObject);
    response.transports = typeof r.getTransports === "function" ? r.getTransports() : [];
  } else {
    response.authenticatorData = bytesToB64url(r.authenticatorData);
    response.signature = bytesToB64url(r.signature);
    if (r.userHandle) response.userHandle = bytesToB64url(r.userHandle);
  }
  return { id: cred.id, rawId: bytesToB64url(cred.rawId), type: cred.type, response, clientExtensionResults: cred.getClientExtensionResults() };
}

export const passkeysSupported = () => typeof window !== "undefined" && "PublicKeyCredential" in window && !!navigator.credentials;

export async function createPasskey(optionsJson: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cred = (await navigator.credentials.create({ publicKey: toCreationOptions(optionsJson) })) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelled");
  return serializeCredential(cred);
}

export async function getPasskey(optionsJson: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cred = (await navigator.credentials.get({ publicKey: toRequestOptions(optionsJson) })) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelled");
  return serializeCredential(cred);
}

const noop = () => () => {};
/** null on the server and during hydration (so markup matches), then the real answer on the client. */
export function usePasskeysSupported(): boolean | null {
  return useSyncExternalStore(noop, passkeysSupported, () => null);
}
