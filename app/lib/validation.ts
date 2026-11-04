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
    fullName: str(form, "fullName").trim(), line1: str(form, "line1").trim(), line2: str(form, "line2").trim(), city: str(form, "city").trim(),
    region: str(form, "region").trim(), postalCode: str(form, "postalCode").trim(), country: str(form, "country").trim().toUpperCase(),
    phone: str(form, "phone").trim(), isDefault: form.get("isDefault") === "on",
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
