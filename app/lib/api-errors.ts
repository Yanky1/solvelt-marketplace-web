import type { FieldErrors } from "./validation";

const FALLBACK: Record<string, string> = {
  displayName: "That name is not accepted.",
  email: "Enter a valid email address.",
  password: "That password is not accepted. Use at least 12 characters and avoid common passwords.",
};

/**
 * Field errors from an API 422, made safe to show: only allow-listed fields survive, text is capped, and fields in
 * `fixed` always show our own message, never the API's (an "email already registered" must not reach the page:
 * it would let anyone test which addresses have accounts).
 */
export function safeFieldErrors(api: Record<string, string> | undefined, allowed: readonly string[], fixed: readonly string[] = []): FieldErrors {
  const out: FieldErrors = {};
  if (!api) return out;
  for (const field of allowed) {
    const msg = api[field];
    if (typeof msg !== "string" || !msg) continue;
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is being stripped
    out[field] = fixed.includes(field) ? (FALLBACK[field] ?? "Check this field.") : msg.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160);
  }
  return out;
}
