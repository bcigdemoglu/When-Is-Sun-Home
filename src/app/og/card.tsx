/**
 * The link-preview card, as JSX for `next/og` (Satori).
 *
 * Satori understands a subset of CSS: flexbox only, every element with more
 * than one child needs an explicit `display: flex`, no CSS variables — hence
 * the literal colours below (the light "warm paper" palette of the app; link
 * previews have no dark mode). Only the bundled Geist Regular is used: no font
 * is fetched at request time.
 */
import type { ReactElement } from "react";
import { bestWorstLine } from "@/components/share/describe";
import type { PlaceSummary } from "@/lib/types";
import { formatSunHours } from "@/state/urlCodec";
import { SITE_NAME, SITE_TAGLINE, type OgCard } from "./model";

const C = {
  page: "#F5F0E6",
  surface: "#FFFDF8",
  track: "#EDE6D8",
  line: "#E0D7C6",
  ink: "#1E1A15",
  ink2: "#5A5348",
  ink3: "#756D61",
  sun: "#eda100",
  sunEdge: "#b97a00",
} as const;

const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] as const;

function SunMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <g stroke={C.sun} strokeWidth="5" strokeLinecap="round">
        <line x1="32" y1="4" x2="32" y2="11" />
        <line x1="32" y1="53" x2="32" y2="60" />
        <line x1="4" y1="32" x2="11" y2="32" />
        <line x1="53" y1="32" x2="60" y2="32" />
        <line x1="12.2" y1="12.2" x2="17.2" y2="17.2" />
        <line x1="46.8" y1="46.8" x2="51.8" y2="51.8" />
        <line x1="12.2" y1="51.8" x2="17.2" y2="46.8" />
        <line x1="46.8" y1="17.2" x2="51.8" y2="12.2" />
      </g>
      <circle cx="32" cy="32" r="14" fill={C.sun} stroke={C.sunEdge} strokeWidth="2" />
    </svg>
  );
}

/** Room for the place label, right of the brand. */
const LABEL_WIDTH = 640;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "48px 56px 40px",
        backgroundColor: C.page,
        color: C.ink,
        fontFamily: "Geist, sans-serif",
      }}
    >
      {children}
    </div>
  );
}

function Header({ label, viewpoint }: { label?: string; viewpoint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <SunMark size={44} />
        <div style={{ display: "flex", marginLeft: 14, fontSize: 30, letterSpacing: -0.3 }}>
          {SITE_NAME}
        </div>
      </div>
      {label ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            width: LABEL_WIDTH,
          }}
        >
          {/* `display: block` + lineClamp: Satori's way to cut one line with an ellipsis. */}
          <div
            style={{
              display: "block",
              maxWidth: LABEL_WIDTH,
              lineClamp: 1,
              textAlign: "right",
              fontSize: 32,
              WebkitTextStroke: `0.7px ${C.ink}`,
            }}
          >
            {label}
          </div>
          {viewpoint ? (
            <div style={{ display: "flex", marginTop: 4, fontSize: 24, color: C.ink2 }}>
              {viewpoint}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Footer({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        paddingTop: 22,
        borderTop: `2px solid ${C.line}`,
        fontSize: 25,
        color: C.ink2,
      }}
    >
      {text}
    </div>
  );
}

const CHART_HEIGHT = 206;
const BAR_WIDTH = 28;
const BAR_GAP = 10;

/** Hours for a bar label: one decimal, whole numbers from 10 up so twelve labels fit. */
function barLabel(hours: number): string {
  if (hours <= 0) return "0";
  return hours >= 9.95 ? String(Math.round(hours)) : hours.toFixed(1);
}

/**
 * The app's "Sun hours" card: twelve bars of direct sun (amber), each standing
 * in a track as tall as the month's daylight, with the hours above it.
 */
function MonthlyBars({ summary }: { summary: PlaceSummary }) {
  const scale = Math.max(12, ...summary.monthlyDaylightHours);
  const px = (hours: number) => Math.round((Math.max(0, hours) / scale) * CHART_HEIGHT);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "26px 30px 22px",
        backgroundColor: C.surface,
        border: `2px solid ${C.line}`,
        borderRadius: 28,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", fontSize: 21, color: C.ink2 }}>
        <div style={{ display: "flex", fontSize: 27, color: C.ink, marginRight: 30 }}>
          Sun hours
        </div>
        <div
          style={{
            display: "flex",
            width: 18,
            height: 18,
            borderRadius: 5,
            backgroundColor: C.sun,
            border: `2px solid ${C.sunEdge}`,
          }}
        />
        <div style={{ display: "flex", marginLeft: 9 }}>Direct sun</div>
        <div
          style={{
            display: "flex",
            width: 18,
            height: 18,
            marginLeft: 26,
            borderRadius: 5,
            backgroundColor: C.track,
          }}
        />
        <div style={{ display: "flex", marginLeft: 9 }}>Daylight</div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          height: CHART_HEIGHT + 26,
          marginTop: 16,
        }}
      >
        {summary.monthlySunHours.map((sun, month) => {
          const trackHeight = Math.max(4, px(summary.monthlyDaylightHours[month]));
          // Any sun at all gets a visible sliver; none at all gets no bar.
          const sunHeight = sun > 0 ? Math.min(trackHeight, Math.max(12, px(sun))) : 0;
          return (
            <div
              key={month}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: BAR_WIDTH + BAR_GAP,
                marginLeft: month === 0 ? -BAR_GAP / 2 : 0,
              }}
            >
              <div style={{ display: "flex", fontSize: 16, color: C.ink, marginBottom: 6 }}>
                {barLabel(sun)}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  width: BAR_WIDTH,
                  height: trackHeight,
                  borderRadius: 8,
                  backgroundColor: C.track,
                }}
              >
                {sunHeight > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      width: BAR_WIDTH,
                      height: sunHeight,
                      borderRadius: Math.min(8, sunHeight / 2),
                      backgroundColor: C.sun,
                      border: `2px solid ${C.sunEdge}`,
                    }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", marginTop: 10, fontSize: 20, color: C.ink3 }}>
        {MONTH_LETTERS.map((letter, month) => (
          <div
            key={month}
            style={{
              display: "flex",
              justifyContent: "center",
              width: BAR_WIDTH,
              marginLeft: month === 0 ? 0 : BAR_GAP,
            }}
          >
            {letter}
          </div>
        ))}
      </div>
    </div>
  );
}

function Eyebrow({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", fontSize: 23, letterSpacing: 2.2, color: C.ink2 }}>{text}</div>
  );
}

function SummaryCard({
  label,
  viewpoint,
  summary,
}: {
  label: string;
  viewpoint: string;
  summary: PlaceSummary;
}) {
  const hasSun = summary.avgSunHoursPerDay > 0;
  const range = bestWorstLine(summary);
  const percent = Math.round(summary.sunFraction * 100);
  const detail = hasSun
    ? (range ?? "About the same in every month")
    : "No direct sun at any time of year";
  return (
    <Frame>
      <Header label={label} viewpoint={viewpoint} />
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 548 }}>
          <Eyebrow text="DIRECT SUN · AVERAGE DAY" />
          {hasSun ? (
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 2 }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 176,
                  lineHeight: 1.08,
                  letterSpacing: -5,
                  WebkitTextStroke: `4px ${C.ink}`,
                }}
              >
                {formatSunHours(summary.avgSunHoursPerDay).replace(" h", "")}
              </div>
              <div style={{ display: "flex", marginLeft: 14, fontSize: 76, color: C.ink2 }}>h</div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                marginTop: 8,
                fontSize: 132,
                letterSpacing: -3,
                WebkitTextStroke: `3px ${C.ink}`,
              }}
            >
              None
            </div>
          )}
          <div
            style={{
              display: "flex",
              marginTop: 4,
              // "12.7 h in September · 10.2 h in November" must still fit on one line.
              fontSize: detail.length > 36 ? 26 : detail.length > 31 ? 28 : 31,
              color: C.ink2,
            }}
          >
            {detail}
          </div>
        </div>
        <MonthlyBars summary={summary} />
      </div>
      <Footer
        text={`${percent}% of possible daylight · clear-sky estimate from building and terrain data`}
      />
    </Frame>
  );
}

function GenericPlaceCard({ label, viewpoint }: { label: string; viewpoint: string }) {
  return (
    <Frame>
      <Header />
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 800 }}>
          <Eyebrow text={viewpoint.toUpperCase()} />
          <div
            style={{
              display: "block",
              maxWidth: 800,
              lineClamp: 2,
              wordBreak: "break-word",
              marginTop: 10,
              fontSize: label.length > 18 ? 68 : 84,
              lineHeight: 1.1,
              letterSpacing: -2,
              WebkitTextStroke: `2px ${C.ink}`,
            }}
          >
            {label}
          </div>
          <div style={{ display: "flex", marginTop: 10, fontSize: 40, color: C.ink2 }}>
            See when this spot gets direct sun
          </div>
        </div>
        <SunMark size={220} />
      </div>
      <Footer text="Hour by hour, through the year · clear-sky estimate from building and terrain data" />
    </Frame>
  );
}

function BrandCard() {
  return (
    <Frame>
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 830 }}>
          <Eyebrow text="DIRECT SUN · HOUR BY HOUR · ALL YEAR" />
          <div
            style={{
              display: "flex",
              marginTop: 12,
              fontSize: 86,
              letterSpacing: -2,
              WebkitTextStroke: `2.2px ${C.ink}`,
            }}
          >
            {SITE_NAME}
          </div>
          <div style={{ display: "flex", marginTop: 14, fontSize: 35, color: C.ink2 }}>
            {SITE_TAGLINE}
          </div>
        </div>
        <SunMark size={220} />
      </div>
      <Footer text="With the shade of nearby buildings and hills · clear-sky estimate" />
    </Frame>
  );
}

/** The JSX for a card. Pure. */
export function ogCardElement(card: OgCard): ReactElement {
  if (card.kind === "brand") return <BrandCard />;
  if (card.summary === null) {
    return <GenericPlaceCard label={card.label} viewpoint={card.viewpoint} />;
  }
  return <SummaryCard label={card.label} viewpoint={card.viewpoint} summary={card.summary} />;
}
