/**
 * Public API of the client state layer.
 *
 * Typical wiring, in one client component near the root:
 *
 *   const hydrated = useHydrateSettings(); // storage, then URL — once
 *   useUrlSync();                          // settings → address bar, rate limited
 *   if (!hydrated) return <Skeleton />;    // the store still holds defaults
 *
 * and anywhere below:
 *
 *   const observer = useSettings(selectObserver);
 *   const setObserver = useSettings((s) => s.setObserver);
 *
 * `schema`, `urlCodec` and `selectors` are pure and may be imported directly
 * (`@/state/urlCodec`) from server code such as `generateMetadata`.
 */
export {
  DEFAULT_LAYERS,
  DEFAULT_OBSERVER,
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  defaultSettings,
  isSettings,
  isValidIsoDate,
  layersSchema,
  mergeSettings,
  normalizeFacingDeg,
  normalizeFovDeg,
  normalizeHeightM,
  normalizeLat,
  normalizeLng,
  normalizeMinuteOfDay,
  normalizePlaceName,
  observerSchema,
  placeSchema,
  sanitizeSettings,
  settingsSchema,
} from "./schema";
export type { LayerKey, Layers, Settings, SettingsPatch } from "./schema";

export {
  LEGACY_URL_KEYS,
  MONTH_NAMES,
  SUMMARY_URL_KEY,
  URL_KEYS,
  buildShareUrl,
  dayOfYearToIsoDate,
  decodeSummaryParam,
  encodeSummaryParam,
  formatSunHours,
  hhmmToMinuteOfDay,
  isEmptyPatch,
  isLegacySearchParams,
  minuteOfDayToHHMM,
  overlayUrlSettings,
  roundSettingsForUrl,
  searchParamsToSettings,
  searchParamsToSummary,
  settingsToSearchParams,
  shareText,
} from "./urlCodec";
export type {
  BuildShareUrlOptions,
  SearchParamsToSettingsOptions,
  ShareTextOptions,
} from "./urlCodec";

export {
  LEGACY_STORAGE_KEYS,
  PERSIST_THROTTLE_MS,
  SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_VERSION,
  hydrateSettings,
  isSettingsHydrated,
  onSettingsHydrated,
  pickSettings,
  settingsStorage,
  useHydrateSettings,
  useSettings,
  useSettingsHydrated,
} from "./store";
export type { HydrateSettingsOptions, SettingsActions, SettingsStore } from "./store";

export {
  URL_SYNC_DEBOUNCE_MS,
  URL_SYNC_FAILURE_BACKOFF_MS,
  URL_SYNC_MAX_CALLS_PER_WINDOW,
  URL_SYNC_MAX_RETRIES,
  URL_SYNC_MIN_INTERVAL_MS,
  URL_SYNC_WINDOW_MS,
  setLinkSummary,
  startUrlSync,
  useUrlSync,
} from "./urlSync";
export type { UrlSyncOptions } from "./urlSync";

export {
  EYE_HEIGHT_M,
  MAX_FLOOR,
  STOREY_HEIGHT_M,
  floorToHeightM,
  heightMToFloor,
  selectDate,
  selectHasPlace,
  selectIsLive,
  selectLayers,
  selectMinuteOfDay,
  selectObserver,
  selectObserverMode,
  selectPlace,
} from "./selectors";
