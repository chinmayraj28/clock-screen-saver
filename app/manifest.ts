import type { MetadataRoute } from "next";
import { site } from "./site";

// "Add to Home Screen" opens the clock fullscreen, with no browser chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: "Clock",
    description: site.description,
    start_url: "/",
    display: "fullscreen",
    orientation: "any",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["productivity", "utilities", "weather"],
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
