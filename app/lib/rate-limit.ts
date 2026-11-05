/** What a person is told when the API answered 429: the wait it asked for (Retry-After, in seconds), rounded up to something readable, or a plain "a moment" when it did not say. */
export function tooManyMessage(retryAfter?: number): string {
  if (typeof retryAfter !== "number" || !Number.isFinite(retryAfter) || retryAfter < 1) return "Too many attempts. Please wait a moment and try again.";
  const seconds = Math.min(Math.ceil(retryAfter), 86_400);
  if (seconds < 90) return `Too many attempts. Please wait about ${seconds} ${seconds === 1 ? "second" : "seconds"} and try again.`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `Too many attempts. Please wait about ${minutes} minutes and try again.`;
  const hours = Math.ceil(minutes / 60);
  return `Too many attempts. Please wait about ${hours} ${hours === 1 ? "hour" : "hours"} and try again.`;
}

/** The Retry-After header for a form answer, only when the wait is a sensible number of seconds. */
export function retryAfterHeader(retryAfter?: number): Record<string, string> {
  return typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter >= 1 ? { "Retry-After": String(Math.min(Math.ceil(retryAfter), 86_400)) } : {};
}
