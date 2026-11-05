/**
 * The enrolment secret travels after `#` in the link, so no server, proxy or log ever sees it. Reading it must never throw: a malformed percent escape (`%E0%A4%A`) used to make
 * `decodeURIComponent` throw before the address was cleaned, which left the secret in the address bar (security review LOW-7). The caller strips the fragment FIRST, then decodes here.
 */
export function tokenFromHash(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw || raw.length > 400) return "";
  try { return decodeURIComponent(raw); } catch { return raw; }
}
