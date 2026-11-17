import { ImageResponse } from "next/og";

// iOS ignores SVG icons for "Add to Home Screen", so render the same mark as a PNG.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a" }}>
        <svg width="120" height="120" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="10" fill="none" stroke="#ededea" strokeWidth="1.5" />
          <path d="M16 10v6l4 2.5" fill="none" stroke="#8ab4f8" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </div>
    ),
    size,
  );
}
