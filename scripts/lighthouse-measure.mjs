// The decision of the Lighthouse script about a run that could not be measured (kept apart from the script so a test can drive it without a browser).
//
// A measurement failure (Lighthouse's `runtimeError`, for example NO_NAVSTART: "something went wrong with recording the trace over your page load") says nothing about the page: it is the
// browser or the runner. Such a run is measured AGAIN, once, as a fresh measurement. Nothing else is ever retried: a score under its threshold, a layout shift over its limit and any other
// runtime error fail at once, and the thresholds are the script's, unchanged. A second measurement failure fails the run and says why.

/** Runtime error codes that are the measurement's fault and not the page's. */
export const RETRYABLE_RUNTIME_ERRORS = new Set(["NO_NAVSTART"]);

/**
 * @param {() => Promise<{ lhr: any }>} measure  one fresh Lighthouse measurement of the page
 * @param {(message: string) => void} [note]  told once when a measurement is repeated
 * @returns {Promise<any>} the Lighthouse result to judge (the repeated one, when there was a repeat)
 */
export async function measureWithRetry(measure, note = () => {}) {
  const first = (await measure()).lhr;
  const code = first.runtimeError?.code;
  if (!code || !RETRYABLE_RUNTIME_ERRORS.has(code)) return first;
  note(`  note: ${code} is a failure of the measurement, not of the page: measuring again once`);
  return (await measure()).lhr;
}
