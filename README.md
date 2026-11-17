# Desk Clock

A full-screen dark clock for an always-on display. It shows a large clock, the date, local weather from Open-Meteo (free, no API key), sunrise and sunset, the next six hours, and how much of the day has passed.

## Run it

```bash
npm install
npm run build
npm start            # serves on http://localhost:3000 (all network interfaces)
```

Open it full-screen in kiosk mode:

```bash
start msedge --kiosk http://localhost:3000 --edge-kiosk-type=fullscreen
```

To view it from another device on your network, run `ipconfig` and find this PC's IPv4 address, then open `http://<that-ip>:3000`. You may need to allow Node.js through Windows Firewall the first time.

To stop the server, press `Ctrl+C` in the terminal running `npm start`. To restart it, run `npm start` again. After changing the code or the config, run `npm run build` and then `npm start`.

## Deploy (Vercel)

```bash
npx vercel deploy --prod
```

Everything happens in the visitor's browser, so time, timezone, location and weather are always the visitor's own. Note that Open-Meteo's free tier is for non-commercial use, with a limit of 10,000 calls per day per visitor IP.

## Keys

| Key | Action |
| --- | --- |
| `F` or double-click | Toggle fullscreen |
| `T`, or click/tap the clock | Switch between 12h and 24h (remembered in this browser) |
| `U`, or click/tap the temperature | Switch between °C and °F (remembered in this browser) |
| `S`, or the sliders button (top left) | Settings: show or hide seconds, date, weather, next hours, sun, day progress |

If weather, next hours and sun are all hidden, the page skips the weather fetch and the location prompt entirely.

## Calendar

Paste a calendar's secret iCal (ICS) address into Settings to show the meeting in progress, or the next one within 12 hours, under the date. If there's no meeting, today's all-day event shows instead.

- **Google Calendar:** Settings › your calendar › "Secret address in iCal format"
- **Outlook:** Settings › Calendar › Shared calendars › Publish a calendar › ICS link

The address is saved in the browser. It goes to `/api/calendar` only so the server can fetch the feed, because calendar feeds block direct browser requests. Nothing is stored on the server. The route accepts only `https://` or `webcal://` on port 443, and refuses private or internal addresses and feeds over 5 MB. It re-checks the address after every redirect.

Run `npm run check` to test the ICS parser (recurrence, timezones, EXDATE, moved occurrences, all-day and cancelled events).

## Configure (`app/config.ts`)

- **City:** `location: null` detects your location automatically. It tries browser geolocation first, then an IP lookup, then `fallbackLocation`. To pin a city, set something like `location: { name: "Paris", lat: 48.8566, lon: 2.3522 }`.
- **Units:** `units: "C"` or `"F"`.
- **12h/24h:** `hour12: "auto"` follows the browser locale. Set it to `true` or `false` to force one.
- **Accent color:** `accent: "#8ab4f8"`. Any CSS color works.

After a `T` or `U` key press, that browser's saved choice overrides the config. To clear it, run `localStorage.clear()` in the browser devtools console.

## Notes

- Weather refreshes every 15 minutes and is cached in the browser. If a fetch fails, the last good data stays on screen with a "stale" hint. The clock and date work without internet.
- Screen Wake Lock needs a secure origin. It works on `localhost` but not on plain-HTTP LAN URLs, so other devices showing the page may still go to sleep.
- Burn-in protection moves the whole layout by a few pixels every 3 minutes. The cursor hides after 3 seconds of inactivity.
