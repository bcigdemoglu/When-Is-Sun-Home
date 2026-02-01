import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "When is Sun Home?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 30%, #d97706 70%, #92400e 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 120, marginBottom: 16 }}>☀️</div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            color: "white",
            textShadow: "0 2px 10px rgba(0,0,0,0.3)",
            marginBottom: 12,
          }}
        >
          When is Sun Home?
        </div>
        <div
          style={{
            fontSize: 28,
            color: "rgba(255,255,255,0.9)",
            textShadow: "0 1px 4px rgba(0,0,0,0.2)",
          }}
        >
          Track the sun&apos;s position on an interactive map
        </div>
      </div>
    ),
    { ...size }
  );
}
