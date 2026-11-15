/**
 * Client for the app's own `GET /api/buildings?area=<key>` route, which
 * queries Overpass on the server and is cached by the CDN (see `server.ts`).
 */
import { z } from "zod";
import type { BuildingCollection, BuildingFeature } from "@/lib/types";
import { isAbortError } from "./overpass";

export const BUILDINGS_API_PATH = "/api/buildings";
/** A little over the route's own 25 s budget, so its error arrives before ours. */
export const BUILDINGS_API_TIMEOUT_MS = 28_000;

export type BuildingsApiErrorKind = "bad-request" | "http" | "malformed" | "network" | "timeout";

export class BuildingsApiError extends Error {
  readonly kind: BuildingsApiErrorKind;
  /** HTTP status, when the route answered at all. */
  readonly status?: number;

  constructor(
    kind: BuildingsApiErrorKind,
    message: string,
    details: { status?: number; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "BuildingsApiError";
    this.kind = kind;
    this.status = details.status;
  }
}

// ─── Payload validation ────────────────────────────────────────────────────

const positionSchema = z.array(z.number()).min(2);
const ringSchema = z.array(positionSchema).min(4);
const polygonSchema = z.array(ringSchema).min(1);

const featureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({
    id: z.string().min(1),
    heightM: z.number().positive(),
    heightSource: z.enum(["tagged", "levels", "default"]),
    levels: z.number().nullable(),
    kind: z.string(),
    name: z.string().optional(),
  }),
  geometry: z.discriminatedUnion("type", [
    z.object({ type: z.literal("Polygon"), coordinates: polygonSchema }),
    z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygonSchema).min(1) }),
  ]),
});

const collectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.unknown()),
});

/**
 * Validate a `BuildingCollection` that came over the wire.
 *
 * Lenient about single features (a bad one is dropped), strict about the
 * whole: it must be a FeatureCollection, and if it has features at least one
 * must be a usable building. Throws `BuildingsApiError("malformed")`.
 */
export function parseBuildingCollection(json: unknown): BuildingCollection {
  const collection = collectionSchema.safeParse(json);
  if (!collection.success) {
    throw new BuildingsApiError("malformed", "Buildings response is not a FeatureCollection");
  }
  const features: BuildingFeature[] = [];
  for (const candidate of collection.data.features) {
    const feature = featureSchema.safeParse(candidate);
    if (feature.success) features.push(feature.data);
  }
  if (features.length === 0 && collection.data.features.length > 0) {
    throw new BuildingsApiError("malformed", "Buildings response contains no usable building");
  }
  return { type: "FeatureCollection", features };
}

// ─── Request ───────────────────────────────────────────────────────────────

export interface FetchBuildingsFromApiOptions {
  /** Aborting rejects with an AbortError. */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Origin of the deployment to ask, e.g. "https://example.vercel.app". Default: same origin. */
  baseUrl?: string;
  /** Skip the browser's HTTP cache (the CDN may still answer from its own). */
  reload?: boolean;
}

/**
 * The route's URL for an area. The key goes in as it is, not percent-encoded:
 * its characters are all legal in a query string, and the route accepts only
 * this one spelling so that every area has exactly one cacheable URL.
 */
export function buildingsApiUrl(areaKey: string, baseUrl = ""): string {
  return `${baseUrl.replace(/\/+$/, "")}${BUILDINGS_API_PATH}?area=${areaKey}`;
}

/** The route's `{ error, message }` body, if that is what `text` is. */
function errorMessageFrom(text: string): string | null {
  try {
    const body: unknown = JSON.parse(text);
    const message = (body as { message?: unknown } | null)?.message;
    return typeof message === "string" && message ? message.slice(0, 300) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the buildings of one area from the app's API route.
 *
 * Rejects with `BuildingsApiError` on a timeout, a network failure, a non-2xx
 * status ("bad-request" for 400) or an unusable payload, and with an
 * AbortError when `signal` aborts.
 */
export async function fetchBuildingsFromApi(
  areaKey: string,
  options: FetchBuildingsFromApiOptions = {},
): Promise<BuildingCollection> {
  const {
    signal,
    fetchImpl = globalThis.fetch,
    timeoutMs = BUILDINGS_API_TIMEOUT_MS,
    baseUrl,
    reload = false,
  } = options;
  const abortError = () =>
    isAbortError(signal?.reason)
      ? signal?.reason
      : new DOMException("The operation was aborted.", "AbortError");
  if (signal?.aborted) throw abortError();

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(buildingsApiUrl(areaKey, baseUrl), {
        signal: controller.signal,
        ...(reload ? { cache: "reload" as const } : {}),
      });
      text = await response.text();
    } catch (cause) {
      if (signal?.aborted) throw abortError();
      if (timedOut) {
        throw new BuildingsApiError(
          "timeout",
          `The buildings service did not answer within ${timeoutMs} ms`,
          { cause },
        );
      }
      throw new BuildingsApiError("network", "Could not reach the buildings service", { cause });
    }

    if (!response.ok) {
      const { status } = response;
      const detail = errorMessageFrom(text);
      throw new BuildingsApiError(
        status === 400 ? "bad-request" : "http",
        `The buildings service answered HTTP ${status}${detail ? `: ${detail}` : ""}`,
        { status },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      throw new BuildingsApiError("malformed", "Buildings response is not valid JSON", {
        status: response.status,
        cause,
      });
    }
    return parseBuildingCollection(json);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
