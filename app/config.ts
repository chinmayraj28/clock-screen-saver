export type Place = { name: string; lat: number; lon: number };

export const config = {
  // null = auto-detect (browser geolocation, then IP lookup, then fallbackLocation).
  // Pin a city instead, e.g. { name: "Bengaluru", lat: 12.9716, lon: 77.5946 }
  location: null as Place | null,
  fallbackLocation: { name: "London", lat: 51.5072, lon: -0.1276 } as Place,

  // Defaults. The T (12h/24h) and U (°C/°F) keys override these and are remembered per browser.
  units: "C" as "C" | "F",
  hour12: "auto" as "auto" | boolean, // "auto" follows the system/browser locale

  accent: "#8ab4f8",

  // Client ID of your Spotify app (public by design: sign-in uses PKCE, no secret).
  // Spotify limits personal apps to 5 allowlisted accounts; other visitors can paste their own Client ID in Settings.
  spotifyClientId: "",
};
