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

/**
 * Strips C0/C1 control characters and bidirectional override/isolate marks (U+202A-202E, U+2066-2069, U+200E/F, U+061C):
 * they can hide or reorder text in names and addresses shown to people or printed on labels. Use for free-text fields only.
 */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is being stripped
export const cleanText = (s: string): string => s.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");

export const cleanField = (form: FormData, key: string): string => cleanText(str(form, key)).trim();

export const str = (form: FormData, key: string): string => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

export const COUNTRIES: Record<string, string> = {
  US: "United States", CA: "Canada", GB: "United Kingdom", IL: "Israel", AU: "Australia", DE: "Germany", FR: "France", MX: "Mexico", BR: "Brazil", IN: "India",
};

const PHONE = /^\+?[0-9 ()\-.]{6,24}$/;

export function validatePhone(v: string, required = false): string | null {
  const p = v.trim();
  if (!p) return required ? "Enter a phone number." : null;
  return PHONE.test(p) && (p.match(/\d/g)?.length ?? 0) >= 6 ? null : "Enter a valid phone number.";
}

export interface AddressInput {
  fullName: string; line1: string; line2: string; city: string; region: string; postalCode: string; country: string; phone: string; isDefault: boolean;
}

export function readAddress(form: FormData): AddressInput {
  return {
    fullName: cleanField(form, "fullName"), line1: cleanField(form, "line1"), line2: cleanField(form, "line2"), city: cleanField(form, "city"),
    region: cleanField(form, "region"), postalCode: cleanField(form, "postalCode"), country: cleanField(form, "country").toUpperCase(),
    phone: cleanField(form, "phone"), isDefault: form.get("isDefault") === "on",
  };
}

export function validateAddress(a: AddressInput): FieldErrors {
  const e: FieldErrors = {};
  const req = (k: keyof AddressInput, label: string, max: number) => {
    const v = String(a[k]);
    if (!v) e[k] = `Enter ${label}.`; else if (v.length > max) e[k] = `Use at most ${max} characters.`;
  };
  req("fullName", "the recipient's name", 100);
  req("line1", "the street address", 120);
  req("city", "the city", 80);
  req("postalCode", "the postal code", 20);
  if (a.line2.length > 120) e.line2 = "Use at most 120 characters.";
  if (a.region.length > 80) e.region = "Use at most 80 characters.";
  if (!COUNTRIES[a.country]) e.country = "Choose a country.";
  const phone = validatePhone(a.phone);
  if (phone) e.phone = phone;
  return e;
}
