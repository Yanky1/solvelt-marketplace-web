export type FieldErrors = Record<string, string>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(v: string): string | null {
  const e = v.trim();
  if (!e) return "Enter your email address.";
  if (e.length > 254 || !EMAIL.test(e)) return "Enter a valid email address.";
  return null;
}

export function validateNewPassword(v: string): string | null {
  if (v.length < 12) return "Use at least 12 characters.";
  if (v.length > 128) return "Use at most 128 characters.";
  return null;
}

export function validateDisplayName(v: string): string | null {
  const n = v.trim();
  if (!n) return "Enter your name.";
  if (n.length > 80) return "Use at most 80 characters.";
  return null;
}

export const str = (form: FormData, key: string): string => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};
