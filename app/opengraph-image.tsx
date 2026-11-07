import { ImageResponse } from "next/og";

// Social preview card (Open Graph + Twitter): 1200×630, drawn at request time so it needs no binary asset.
export const alt = "Norveko: write the idea, get the video";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 90px",
          background: "linear-gradient(135deg, #0a0a12 0%, #141233 55%, #2b1a5c 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 44,
              fontWeight: 800,
            }}
          >
            N
          </div>
          <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: 4 }}>NORVEKO</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 48, fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>
          <span>Write the idea.</span>
          <span style={{ color: "#a78bfa" }}>Get the video.</span>
        </div>
        <div style={{ marginTop: 36, fontSize: 30, color: "#cbd5e1" }}>
          Research, script, voice, visuals, music and MP4, then publish to YouTube, TikTok and Instagram.
        </div>
      </div>
    ),
    size,
  );
}
