/** Fetching JSON from a geocoder: with a deadline, and with failures told apart. */

/** The service did not answer in time. Counts as "the service is down". */
export class GeocoderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Place search timed out after ${timeoutMs} ms`);
    this.name = "GeocoderTimeoutError";
  }
}

/** True for the rejection of a request its caller aborted — not a failure of the service. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export interface GetJsonOptions {
  /** The caller's signal: aborting it rejects with its AbortError. */
  signal?: AbortSignal;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

/**
 * GET `url` and parse the body as JSON.
 *
 * Rejects with the caller's AbortError when aborted, a `GeocoderTimeoutError`
 * when neither headers nor body arrive within `timeoutMs`, and an Error
 * naming the status for anything but 2xx. No custom headers are sent, so the
 * request stays a CORS "simple request" (and the browser's Referer is what
 * identifies the app to the service).
 */
export async function getJson(url: URL, options: GetJsonOptions): Promise<unknown> {
  const { signal, timeoutMs, fetchImpl } = options;
  const aborted = () => new DOMException("Aborted", "AbortError");
  if (signal?.aborted) throw aborted();

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  // The request loses the race against the deadline and the caller's abort
  // even if whatever does the fetching ignores its signal.
  const stopped = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new GeocoderTimeoutError(timeoutMs));
    }, timeoutMs);
    onAbort = () => {
      controller.abort();
      reject(aborted());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

  const request = (async () => {
    const response = await fetchImpl(url.toString(), { signal: controller.signal });
    if (!response.ok) throw new Error(`Place search failed (HTTP ${response.status})`);
    return (await response.json()) as unknown;
  })();
  // Whichever loses the race must not surface as an unhandled rejection.
  request.catch(() => {});
  stopped.catch(() => {});

  try {
    return await Promise.race([request, stopped]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
