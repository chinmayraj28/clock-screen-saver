import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { site } from "./site";

export const alt = `${site.name}: a large thin clock with the date, weather and next meeting on a near-black screen`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (w: number) => readFile(join(process.cwd(), `assets/Geist-${w}.ttf`));

export default async function Image() {
  const [thin, regular] = await Promise.all([font(200), font(400)]);
  const muted = "rgba(237,237,234,0.45)";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#ededea",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", fontSize: 260, fontWeight: 200, lineHeight: 0.9, letterSpacing: -6 }}>
          <span>09</span>
          <span style={{ color: "#8ab4f8", opacity: 0.6, margin: "0 6px", position: "relative", top: -18 }}>:</span>
          <span>41</span>
          <span style={{ fontSize: 34, marginLeft: 18, marginBottom: 22, color: "rgba(237,237,234,0.3)", letterSpacing: 1 }}>27</span>
        </div>
        <div style={{ display: "flex", marginTop: 34, fontSize: 36, fontWeight: 200, color: muted }}>Tuesday, 17 November</div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 18, fontSize: 26, fontWeight: 200, color: muted }}>
          <div style={{ width: 10, height: 10, borderRadius: 10, background: "#8ab4f8", marginRight: 14 }} />
          <span style={{ color: "rgba(237,237,234,0.75)" }}>Design review</span>
          <span style={{ marginLeft: 12, color: "rgba(237,237,234,0.35)" }}>in 8 min</span>
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 40,
            left: 56,
            right: 56,
            display: "flex",
            justifyContent: "space-between",
            fontSize: 22,
            fontWeight: 400,
            color: "rgba(237,237,234,0.35)",
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          <span>{site.name}</span>
          <span style={{ letterSpacing: 1, textTransform: "none" }}>{site.url.replace("https://", "")}</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: thin, weight: 200, style: "normal" },
        { name: "Geist", data: regular, weight: 400, style: "normal" },
      ],
    },
  );
}
