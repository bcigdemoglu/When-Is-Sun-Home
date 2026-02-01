import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)",
          borderRadius: 36,
        }}
      >
        <div style={{ fontSize: 100 }}>☀️</div>
      </div>
    ),
    { ...size }
  );
}
