/** Words and checks for the messages pages (M5). Pure helpers: no I/O. */

export const WARNING_LABEL: Record<string, string> = {
  email: "an email address", phone: "a phone number", link: "a web link", payment_or_chat_app: "a payment or chat app",
};

/** Names the kinds of contact details the API found, in plain words ("an email address and a phone number"). Unknown kinds are left out. */
export function warningText(kinds: string[]): string {
  const words = kinds.map((k) => WARNING_LABEL[k]).filter((x): x is string => !!x);
  if (words.length === 0) return "contact or payment details";
  return words.length === 1 ? words[0]! : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export const MAX_TEXT = 4000;

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const DELIVERY_STATE: Record<string, string> = { pending: "Sending…", sent: "Sent", failed: "Not delivered" };
