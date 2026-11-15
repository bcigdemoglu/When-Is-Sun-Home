"use client";

/**
 * Developer harness for sharing: both <ShareButton> variants with a seeded
 * place and summary, the link they produce, what the link decodes back to,
 * and the link-preview image the server renders for it.
 *
 * The store is seeded directly and never hydrated here, so nothing on this
 * page touches the saved settings in localStorage.
 *
 * To try the phone path on a desktop: tick "Pretend this is a phone" (it
 * installs a fake `navigator.share` that logs below and reports a coarse
 * pointer), or use the browser's device toolbar.
 */
import { useEffect, useState } from "react";
import { ShareButton } from "@/components/share/ShareButton";
import { isLiveView, shareLink } from "@/components/share/shareLink";
import { useToasts } from "@/components/ui/toast";
import type { Observer, Place, PlaceSummary } from "@/lib/types";
import { pickSettings, searchParamsToSummary, shareText, useSettings } from "@/state";
import { ogImagePath } from "../../og/model";

const PLACE: Place = {
  lat: 37.7912,
  lng: -122.4301,
  name: "2550 Pacific Ave, San Francisco, CA 94115",
};

/** Real engine output for PLACE from the recorded Pacific Heights buildings, 2026. */
const SUMMARIES: Record<Observer["mode"], PlaceSummary> = {
  yard: {
    year: 2026,
    avgSunHoursPerDay: 6.5,
    sunFraction: 0.54,
    totalSunHours: 2385,
    monthlySunHours: [0, 0.1, 6.1, 11.8, 12.7, 12.5, 12.6, 12.3, 8.6, 1.3, 0, 0],
    monthlyDaylightHours: [9.7, 10.7, 11.8, 13.1, 14.1, 14.6, 14.3, 13.4, 12.3, 11, 10, 9.4],
    bestMonth: 4,
    worstMonth: 0,
  },
  window: {
    year: 2026,
    avgSunHoursPerDay: 4,
    sunFraction: 0.34,
    totalSunHours: 1477,
    monthlySunHours: [3.6, 4.9, 5, 4.9, 3.7, 3.1, 3.4, 4.5, 5.2, 5, 4.3, 1.2],
    monthlyDaylightHours: [9.7, 10.7, 11.8, 13.1, 14.1, 14.6, 14.3, 13.4, 12.3, 11, 10, 9.4],
    bestMonth: 8,
    worstMonth: 11,
  },
};

const OBSERVERS: Record<Observer["mode"], Observer> = {
  yard: { mode: "yard", heightM: 1, facingDeg: 180, fovDeg: 180 },
  window: { mode: "window", heightM: 4.5, facingDeg: 180, fovDeg: 120 },
};

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        className="size-4 accent-ink"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[20px] border border-line bg-surface p-4">
      <h2 className="text-[11px] leading-[14px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export default function ShareHarnessPage() {
  const [mode, setMode] = useState<Observer["mode"]>("yard");
  const [live, setLive] = useState(false);
  const [withSummary, setWithSummary] = useState(true);
  const [savedName, setSavedName] = useState(true);
  const [pretendPhone, setPretendPhone] = useState(false);
  const [shared, setShared] = useState<ShareData[]>([]);
  const [origin, setOrigin] = useState("");
  const toasts = useToasts((state) => state.toasts);

  const label = savedName ? "Pacific Ave backyard" : (PLACE.name ?? "");
  const summary = withSummary ? SUMMARIES[mode] : null;

  // Seed the store the way the app would hold it.
  useEffect(() => {
    useSettings.getState().hydrate({
      place: PLACE,
      observer: OBSERVERS[mode],
      date: live ? null : "2026-06-21",
      minuteOfDay: live ? null : 15 * 60 + 40,
    });
  }, [mode, live]);

  useEffect(() => {
    // After mount only: the server render must not depend on the address bar.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a browser-only value once
    setOrigin(window.location.origin);
  }, []);

  // A stand-in for a phone: a share sheet that only logs, and a coarse pointer.
  useEffect(() => {
    if (!pretendPhone) return;
    const realShare = Object.getOwnPropertyDescriptor(navigator, "share");
    const realMatchMedia = window.matchMedia;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        setShared((previous) => [...previous, data]);
      },
    });
    window.matchMedia = (query: string) =>
      query.includes("pointer: coarse")
        ? ({ ...realMatchMedia.call(window, query), matches: true } as MediaQueryList)
        : realMatchMedia.call(window, query);
    return () => {
      if (realShare) Object.defineProperty(navigator, "share", realShare);
      else delete (navigator as { share?: unknown }).share;
      window.matchMedia = realMatchMedia;
    };
  }, [pretendPhone]);

  const settings = useSettings();
  const current = pickSettings(settings);
  const url = shareLink({
    settings: current,
    place: PLACE,
    label,
    summary,
    includeDateTime: !isLiveView(current),
    base: `${origin}/`,
    // Only reached in live mode, where the date and time are left out anyway.
    now: new Date(0),
  });
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const decoded = searchParamsToSummary(new URLSearchParams(query));
  const roundTrips =
    summary === null
      ? decoded === null
      : decoded !== null &&
        JSON.stringify({ ...decoded, year: summary.year }) === JSON.stringify(summary);
  const text = shareText(label, summary);
  const ogPath = ogImagePath({ ...current, place: { ...PLACE, name: label } }, summary);

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-6 text-ink">
      <h1 className="text-[22px] leading-7 font-semibold">Share harness</h1>
      <p className="mt-1 text-sm text-ink-2">
        Both button variants, the link they produce and the preview a chat would show for it.
      </p>

      <div className="mt-4 grid gap-3">
        <Field title="Seed">
          <div className="flex flex-wrap gap-x-5">
            <Toggle
              label="Window (off: backyard)"
              checked={mode === "window"}
              onChange={(on) => setMode(on ? "window" : "yard")}
            />
            <Toggle label="Live (today, now)" checked={live} onChange={setLive} />
            <Toggle label="Summary ready" checked={withSummary} onChange={setWithSummary} />
            <Toggle label="Saved name as label" checked={savedName} onChange={setSavedName} />
            <Toggle
              label="Pretend this is a phone"
              checked={pretendPhone}
              onChange={setPretendPhone}
            />
          </div>
        </Field>

        <Field title="Buttons">
          <div className="flex flex-wrap items-center gap-3" data-testid="share-buttons">
            <ShareButton place={PLACE} label={label} summary={summary} variant="pill" />
            <ShareButton place={PLACE} label={label} summary={summary} variant="icon" />
            <span className="text-xs text-ink-2">
              pill · icon — {pretendPhone ? "opens the (fake) share sheet" : "opens the popover"}
            </span>
          </div>
        </Field>

        <Field title="Link">
          <p className="font-mono text-xs break-all text-ink-2" data-testid="share-url">
            {url}
          </p>
          <p className="mt-2 text-xs text-ink-2">
            {url.length} characters · summary{" "}
            <span data-testid="share-roundtrip" className="font-semibold text-ink">
              {summary === null
                ? "not included"
                : roundTrips
                  ? "decodes back exactly"
                  : "DOES NOT ROUND-TRIP"}
            </span>
          </p>
          {decoded && (
            <p className="mt-2 rounded-xl bg-surface-2 p-3 font-mono text-[11px] leading-4 break-all text-ink-2">
              {JSON.stringify(decoded)}
            </p>
          )}
        </Field>

        <Field title="Share text (navigator.share)">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-2">title</dt>
            <dd data-testid="share-title">{text.title}</dd>
            <dt className="text-ink-2">text</dt>
            <dd data-testid="share-text">{text.text}</dd>
          </dl>
        </Field>

        <Field title="Link preview image (/og)">
          {/* eslint-disable-next-line @next/next/no-img-element -- a server-rendered PNG, shown as is */}
          <img
            src={ogPath}
            alt="Link preview"
            width={1200}
            height={630}
            className="h-auto w-full rounded-xl border border-line"
            data-testid="og-image"
          />
          <p className="mt-2 font-mono text-[11px] break-all text-ink-2">{ogPath}</p>
        </Field>

        <Field title="Log">
          <ul className="text-sm text-ink-2" data-testid="share-log">
            {shared.length === 0 && toasts.length === 0 && <li>Nothing yet.</li>}
            {shared.map((data, index) => (
              <li key={index} className="font-mono text-xs break-all">
                navigator.share({JSON.stringify(data)})
              </li>
            ))}
            {toasts.map((toast) => (
              <li key={toast.id}>toast: “{toast.message}”</li>
            ))}
          </ul>
        </Field>
      </div>
    </main>
  );
}
