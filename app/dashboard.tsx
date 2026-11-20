"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { config, type Place } from "./config";
import type { CalEvent } from "./api/calendar/ics";
import * as spotify from "./spotify";
import { FocusLine, FocusPanel, useFocus } from "./focus-ui";

type Weather = {
  temp: number;
  feels: number;
  code: number;
  isDay: boolean;
  hi: number;
  lo: number;
  sunrise: number;
  sunset: number;
  hourly: { time: number[]; temp: number[] };
};
type Cached = { place: Place; weather: Weather; at: number };
type Prefs = { hour12?: boolean; units?: "C" | "F"; hidden?: string[]; ics?: string; spotifyClientId?: string };

const WIDGETS = [
  ["seconds", "Seconds"],
  ["date", "Date"],
  ["calendar", "Calendar"],
  ["music", "Spotify"],
  ["focus", "Focus timer"],
  ["weather", "Weather"],
  ["hours", "Next hours"],
  ["sun", "Sunrise & sunset"],
  ["day", "Day progress"],
] as const;
type Widget = (typeof WIDGETS)[number][0];

const REFRESH_MS = 15 * 60_000;
const CACHE_KEY = "deskclock:weather";
const PREFS_KEY = "deskclock:prefs";

// ---------- clock: one timer re-armed on every second boundary, so it never drifts ----------
let now = 0; // 0 = not mounted yet (server prerender renders a placeholder)
function subscribeClock(onTick: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    now = Date.now();
    onTick();
    timer = setTimeout(tick, 1000 - (now % 1000) + 5);
  };
  tick();
  return () => clearTimeout(timer);
}
const useNow = () => useSyncExternalStore(subscribeClock, () => now, () => 0);

// ---------- storage ----------
function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// ---------- location: config → geolocation → IP → fallback ----------
async function getJSON(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

function geolocate() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) return reject();
    // getCurrentPosition's timeout ignores time spent on the permission prompt, so cap it ourselves
    setTimeout(reject, 15_000);
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10_000, maximumAge: 3_600_000 });
  });
}

async function locate(): Promise<Place> {
  if (config.location) return config.location;
  try {
    const { latitude: lat, longitude: lon } = (await geolocate()).coords;
    let name = "Current location";
    try {
      const g = await getJSON(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      );
      name = g.city || g.locality || g.principalSubdivision || name;
    } catch {}
    return { name, lat, lon };
  } catch {}
  try {
    const ip = await getJSON("https://get.geojs.io/v1/ip/geo.json");
    if (ip.latitude) return { name: ip.city || ip.region || "Unknown", lat: +ip.latitude, lon: +ip.longitude };
  } catch {}
  return config.fallbackLocation;
}

async function fetchWeather({ lat, lon }: Place): Promise<Weather> {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,apparent_temperature,weather_code,is_day",
    hourly: "temperature_2m",
    daily: "temperature_2m_max,temperature_2m_min,sunrise,sunset",
    timezone: "auto",
    timeformat: "unixtime",
    forecast_days: "2",
  });
  const j = await getJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
  return {
    temp: j.current.temperature_2m,
    feels: j.current.apparent_temperature,
    code: j.current.weather_code,
    isDay: !!j.current.is_day,
    hi: j.daily.temperature_2m_max[0],
    lo: j.daily.temperature_2m_min[0],
    sunrise: j.daily.sunrise[0] * 1000,
    sunset: j.daily.sunset[0] * 1000,
    hourly: { time: j.hourly.time.map((t: number) => t * 1000), temp: j.hourly.temperature_2m },
  };
}

function useWeather(enabled: boolean) {
  const [data, setData] = useState<Cached | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return; // no fetches and no location prompt while every weather widget is hidden
    let alive = true;
    let place: Promise<Place> | null = null;
    const cached = read<Cached>(CACHE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from cache after mount (localStorage is client-only)
    if (cached) setData(cached);

    const refresh = async () => {
      try {
        place ??= locate();
        const p = await place;
        const next = { place: p, weather: await fetchWeather(p), at: Date.now() };
        write(CACHE_KEY, next);
        if (alive) {
          setData(next);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    };

    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    window.addEventListener("online", refresh);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("online", refresh);
    };
  }, [enabled]);

  return { data, failed };
}

// ---------- calendar (ICS feed fetched through /api/calendar) ----------
const CALENDAR_REFRESH_MS = 10 * 60_000;

type Accounts = { google?: boolean; microsoft?: boolean };
type CalendarState = { events: CalEvent[]; error?: string; connected: Accounts; available: Accounts };

// One request covers the pasted iCal feed and every account connected in this browser (httpOnly cookies).
function useCalendar(enabled: boolean, url: string | undefined) {
  const [state, setState] = useState<CalendarState>({ events: [], connected: {}, available: {} });
  const [reload, setReload] = useState(0);

  // coming back from a Google/Microsoft consent screen: show any error, clean the address bar
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const error = params.get("calendar_error");
    if (!params.has("calendar") && !error) return;
    history.replaceState(null, "", location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the one-off redirect result
    if (error) setState((s) => ({ ...s, error }));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/calendar", { method: "POST", body: JSON.stringify({ url: url || null }) });
        const body = await res.json();
        if (!alive) return;
        if (res.ok) setState({ events: body.events, error: body.error, connected: body.connected, available: body.available });
        else setState((s) => ({ ...s, error: body.error }));
      } catch {
        if (alive) setState((s) => ({ ...s, error: "Offline, showing last events" }));
      }
    };
    load();
    const id = setInterval(load, CALENDAR_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled, url, reload]);

  const disconnect = async (provider: keyof Accounts) => {
    await fetch(`/api/connect/${provider}`, { method: "POST" }).catch(() => {});
    setReload((n) => n + 1);
  };

  return { ...state, events: enabled ? state.events : [], disconnect };
}

// ---------- Spotify now playing ----------
const SPOTIFY_POLL_MS = 5000;

function useSpotify(enabled: boolean) {
  const [connected, setConnected] = useState(false);
  const [track, setTrack] = useState<spotify.NowPlaying>(null);
  const [error, setError] = useState<string | null>(null);
  const [refetch, setRefetch] = useState(0);

  // finish the sign-in redirect (if any) and read the stored session, once
  useEffect(() => {
    spotify.finishConnect().then((err) => {
      setError(err);
      setConnected(spotify.isConnected());
    });
  }, []);

  useEffect(() => {
    if (!enabled || !connected) return;
    let alive = true;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const np = await spotify.nowPlaying();
        if (alive) setTrack(np);
      } catch (e) {
        if (!alive) return;
        setConnected(spotify.isConnected()); // a revoked refresh token signs us out
        setError((e as Error).message);
      }
    };
    poll();
    const id = setInterval(poll, SPOTIFY_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled, connected, refetch]);

  const send = async (cmd: spotify.Command) => {
    if (cmd === "play" || cmd === "pause") setTrack((t) => t && { ...t, playing: cmd === "play" }); // optimistic
    setError(await spotify.control(cmd).catch((e: Error) => e.message));
    setTimeout(() => setRefetch((n) => n + 1), 400);
  };
  const disconnect = () => {
    spotify.disconnect();
    setConnected(false);
    setTrack(null);
  };

  return { connected, track: connected && enabled ? track : null, error, send, disconnect };
}

const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** What to show right now: the meeting in progress, else the next one within 12h, else today's all-day event. */
function agendaLine(events: CalEvent[], t: number, hour12: boolean) {
  const timed = events.filter((e) => !e.allDay);
  const now = timed.find((e) => e.start <= t && e.end > t);
  if (now) return { soon: true, title: now.title, when: `now · until ${timeOf(now.end, hour12)}` };
  const next = timed.find((e) => e.start > t && e.start - t < 12 * 3_600_000);
  if (next) {
    const mins = Math.ceil((next.start - t) / 60_000);
    return { soon: mins <= 10, title: next.title, when: mins < 60 ? `in ${mins} min` : `at ${timeOf(next.start, hour12)}` };
  }
  const today = localDay(t);
  const allDay = events.find((e) => e.allDay && e.startDay <= today && e.endDay > today);
  return allDay ? { soon: false, title: allDay.title, when: "today" } : null;
}

// ---------- display helpers ----------
const systemHour12 = () => !!new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12;
const defaultHour12 = () => (config.hour12 === "auto" ? systemHour12() : config.hour12);
const toggleHour12 = (p: Prefs): Prefs => ({ ...p, hour12: !(p.hour12 ?? defaultHour12()) });
const toggleUnits = (p: Prefs): Prefs => ({ ...p, units: (p.units ?? config.units) === "C" ? "F" : "C" });
const NO_PREFS: Prefs = {}; // initial state sentinel, so we never overwrite stored prefs before loading them
const toggleWidget = (k: Widget) => (p: Prefs): Prefs => {
  const hidden = new Set(p.hidden);
  if (!hidden.delete(k)) hidden.add(k);
  return { ...p, hidden: [...hidden] };
};
const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (t: number, hour12: boolean) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12 }).format(t);
const hourOf = (t: number, hour12: boolean) =>
  hour12 ? new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12 }).format(t).replace(" ", "").toLowerCase() : pad(new Date(t).getHours());
const minuteOfDay = (t: number) => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
};

function phaseOf(t: number, w?: Weather) {
  const m = minuteOfDay(t);
  const rise = w ? minuteOfDay(w.sunrise) : 390;
  const set = w ? minuteOfDay(w.sunset) : 1110;
  if (Math.abs(m - rise) < 60) return "dawn";
  if (Math.abs(m - set) < 60) return "dusk";
  return m > rise && m < set ? "day" : "night";
}
const TINT = { night: "#08080a", dawn: "#100c0b", day: "#0a0c0f", dusk: "#0f0a0d" };

const CONDITIONS: [number[], string, string][] = [
  [[0, 1], "Clear", "clear"],
  [[2], "Partly cloudy", "partly"],
  [[3], "Overcast", "cloud"],
  [[45, 48], "Fog", "fog"],
  [[51, 53, 55, 56, 57], "Drizzle", "rain"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "Rain", "rain"],
  [[71, 73, 75, 77, 85, 86], "Snow", "snow"],
  [[95, 96, 99], "Thunderstorm", "storm"],
];
const condition = (code: number) => CONDITIONS.find(([codes]) => codes.includes(code)) ?? CONDITIONS[2];

const CLOUD = "M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2";
const ICONS: Record<string, string> = {
  sun: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  partly: "M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4M15.9 12.7a4 4 0 0 0-5.9-4.1M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z",
  cloud: "M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z",
  fog: `${CLOUD}M16 17H7M17 21H9`,
  rain: `${CLOUD}M16 14v6M8 14v6M12 16v6`,
  snow: `${CLOUD}M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01`,
  storm: "M6 16.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 .5 9M13 12l-3 5h4l-3 5",
  sunrise: "M12 2v8M4.9 10.9l1.4 1.4M2 18h2M20 18h2M19.1 10.9l-1.4 1.4M22 22H2M8 6l4-4 4 4M16 18a4 4 0 0 0-8 0",
  sunset: "M12 10V2M4.9 10.9l1.4 1.4M2 18h2M20 18h2M19.1 10.9l-1.4 1.4M22 22H2M16 6l-4 4-4-4M16 18a4 4 0 0 0-8 0",
  sliders: "M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4",
  timer: "M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  play: "M7 4.5v15l12-7.5z",
  pause: "M8 5v14M16 5v14",
  previous: "M18 5v14L8 12zM6 5v14",
  next: "M6 5v14l10-7zM18 5v14",
};
function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

const label = "text-[clamp(0.65rem,0.8vw,0.95rem)] font-medium uppercase tracking-[0.18em] text-white/30";
const value = "text-[clamp(1.1rem,2vw,2.4rem)] font-light leading-tight text-white/85";
const sub = "text-[clamp(0.75rem,1vw,1.15rem)] font-light text-white/40";

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-10 py-2 text-sm text-white/70">
      {label}
      <input type="checkbox" checked={checked} onChange={onChange} className="peer sr-only" />
      <span className="relative h-5 w-9 shrink-0 rounded-full bg-white/10 transition-colors peer-checked:bg-(--accent)/60 peer-focus-visible:ring-2 peer-focus-visible:ring-white/40 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white/90 after:transition-transform peer-checked:after:translate-x-4" />
    </label>
  );
}

// ---------- page ----------
export default function Dashboard() {
  const t = useNow();
  const ready = t > 0;
  const [prefs, setPrefs] = useState<Prefs>(NO_PREFS);
  const show = (k: Widget) => !prefs.hidden?.includes(k);
  // wait for stored prefs before fetching, so hidden weather never triggers a location prompt
  const { data, failed } = useWeather(prefs !== NO_PREFS && (show("weather") || show("hours") || show("sun")));
  const calendar = useCalendar(prefs !== NO_PREFS && show("calendar"), prefs.ics);
  const music = useSpotify(show("music"));
  const focus = useFocus(t);
  // while focusing, everything except the clock and the timer steps back
  const dim = `transition-opacity duration-1000 ${focus.focusing ? "opacity-25" : ""}`;
  const spotifyClientId = prefs.spotifyClientId || config.spotifyClientId;
  const root = useRef<HTMLElement>(null);

  // remembered toggles
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setPrefs(read<Prefs>(PREFS_KEY) ?? {});
  }, []);
  useEffect(() => {
    if (prefs !== NO_PREFS) write(PREFS_KEY, prefs);
  }, [prefs]);
  const hour12 = prefs.hour12 ?? (ready ? defaultHour12() : false);
  const units = prefs.units ?? config.units;

  // keys: F fullscreen, T 12/24h, U °C/°F; double-click fullscreen (taps on clock/temp handle mobile)
  useEffect(() => {
    const fullscreen = () =>
      document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen?.().catch(() => {}); // iPhone Safari has no element fullscreen
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement && e.target.type !== "checkbox") return; // typing in a settings field
      const k = e.key.toLowerCase();
      if (k === "f") fullscreen();
      if (k === "t") setPrefs(toggleHour12);
      if (k === "u") setPrefs(toggleUnits);
      if (k === "s") document.getElementById("settings")?.togglePopover();
      if (k === "p") document.getElementById("focus")?.togglePopover();
    };
    // double-clicking a control (e.g. "next" twice) shouldn't flip fullscreen
    const onDblClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest("button, a, input, label, [popover]")) fullscreen();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("dblclick", onDblClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dblclick", onDblClick);
    };
  }, []);

  // screen wake lock (re-acquired when the tab becomes visible again; needs https or localhost)
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {}
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, []);

  // after 3s idle: hide cursor and key hint (CSS keys off data-idle)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      delete root.current?.dataset.idle;
      clearTimeout(timer);
      timer = setTimeout(() => root.current && (root.current.dataset.idle = ""), 3000);
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake); // taps on phones bring the settings button back
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
    };
  }, []);

  const d = new Date(t);
  const h = d.getHours();
  // Before mount, render fixed placeholders: the prerender runs in the server's timezone (UTC on Vercel),
  // so anything derived from the date would mismatch the visitor's hydration.
  const hh = !ready ? "00" : hour12 ? String(h % 12 || 12) : pad(h);
  const mm = ready ? pad(d.getMinutes()) : "00";
  const ss = ready ? pad(d.getSeconds()) : "00";
  const date = ready
    ? `${d.toLocaleDateString("en-GB", { weekday: "long" })}, ${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "long" })} ${d.getFullYear()}`
    : " ";
  const dayPct = ready ? ((d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 864) | 0 : 0; // whole percent

  // burn-in protection: a new few-pixel offset every 3 minutes, derived from the clock
  const slot = Math.floor(t / 180_000);
  const dx = ((slot * 37) % 13) - 6;
  const dy = ((slot * 53) % 9) - 4;

  const w = data?.weather;
  const deg = (c: number) => `${Math.round(units === "F" ? (c * 9) / 5 + 32 : c)}°`;
  const stale = failed || (data && t - data.at > 2 * REFRESH_MS);
  const [, condText, condIcon] = w ? condition(w.code) : [];
  const icon = condIcon === "clear" ? (w?.isDay ? "sun" : "moon") : condIcon;
  const start = w ? w.hourly.time.findIndex((x) => x > t) : -1;
  const hours = start < 0 || !w ? [] : w.hourly.time.slice(start, start + 6).map((x, i) => [x, w.hourly.temp[start + i]] as const);
  const agenda = ready ? agendaLine(calendar.events, t, hour12) : null;

  return (
    <main
      ref={root}
      className="group h-dvh w-full touch-manipulation overflow-hidden transition-colors duration-[60s] ease-linear select-none data-idle:cursor-none"
      style={{ background: TINT[ready ? phaseOf(t, w) : "night"], "--accent": config.accent } as React.CSSProperties}
    >
      <p className="pointer-events-none fixed top-4 right-5 text-[0.7rem] tracking-wide text-white/25 transition-opacity duration-700 group-data-idle:opacity-0 pointer-coarse:hidden">
        F / double-click fullscreen · T 12h/24h · U °C/°F · S settings · P focus
      </p>
      <button
        type="button"
        popoverTarget="settings"
        aria-label="Settings"
        className="fixed top-2 left-3 z-10 rounded-full p-2 text-white/30 transition-opacity duration-700 outline-none hover:text-white/70 focus-visible:text-white/70 group-data-idle:pointer-events-none group-data-idle:opacity-0"
      >
        <Icon name="sliders" className="size-5" />
      </button>
      {show("focus") && (
        <>
          <button
            type="button"
            popoverTarget="focus"
            aria-label="Focus timer"
            className="fixed top-2 left-[3.25rem] z-10 rounded-full p-2 text-white/30 transition-opacity duration-700 outline-none hover:text-white/70 focus-visible:text-white/70 group-data-idle:pointer-events-none group-data-idle:opacity-0"
          >
            <Icon name="timer" className="size-5" />
          </button>
          <FocusPanel focus={focus} />
        </>
      )}
      <div
        id="settings"
        popover="auto"
        className="inset-auto top-14 left-4 m-0 max-h-[calc(100dvh-4.5rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-white/10 bg-[#121214]/95 px-5 py-4 text-white shadow-2xl backdrop-blur"
      >
        <p className={`${label} mb-1`}>Show</p>
        {WIDGETS.map(([k, name]) => (
          <Toggle key={k} label={name} checked={show(k)} onChange={() => setPrefs(toggleWidget(k))} />
        ))}
        <div className="my-2 border-t border-white/[0.06]" />
        <Toggle label="24-hour time" checked={!hour12} onChange={() => setPrefs(toggleHour12)} />
        <Toggle label="Fahrenheit" checked={units === "F"} onChange={() => setPrefs(toggleUnits)} />
        <div className="my-3 border-t border-white/[0.06]" />
        <p className={label}>Calendar</p>
        {(
          [
            ["google", "Google Calendar"],
            ["microsoft", "Outlook"],
          ] as const
        )
          .filter(([p]) => calendar.available[p] || calendar.connected[p])
          .map(([p, name]) =>
            calendar.connected[p] ? (
              <div key={p} className="flex items-center justify-between py-2 text-sm text-white/70">
                {name}
                <button type="button" onClick={() => calendar.disconnect(p)} className="text-xs text-white/40 hover:text-white/80">
                  Disconnect
                </button>
              </div>
            ) : (
              <a
                key={p}
                href={`/api/connect/${p}`}
                className="mt-2 block w-full rounded-lg bg-white/[0.07] py-2 text-center text-sm text-white/80 hover:bg-white/[0.12]"
              >
                Connect {name}
              </a>
            ),
          )}
        <form
          // remount when the stored value loads/changes so the uncontrolled input shows it
          key={prefs.ics ?? ""}
          onSubmit={(e) => {
            e.preventDefault();
            const ics = (new FormData(e.currentTarget).get("ics") as string).trim() || undefined;
            setPrefs((p) => ({ ...p, ics }));
          }}
        >
          <label className="block pt-3">
            <span className="text-[0.7rem] text-white/40">Or paste an iCal address (Apple Calendar, anything else)</span>
            <input
              name="ics"
              type="url"
              defaultValue={prefs.ics}
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              placeholder="https://calendar.google.com/…/basic.ics"
              autoComplete="off"
              spellCheck={false}
              className="mt-2 w-full rounded-lg bg-white/[0.05] px-3 py-2 text-sm text-white/80 outline-none placeholder:text-white/20 focus:ring-1 focus:ring-white/20"
            />
          </label>
        </form>
        {calendar.error && <p className="mt-1.5 text-xs text-amber-200/60">{calendar.error}</p>}
        <p className="mt-1.5 text-[0.7rem] leading-relaxed text-white/30">
          Apple Calendar: share the calendar publicly and copy its webcal:// link.
        </p>
        <div className="my-3 border-t border-white/[0.06]" />
        <p className={label}>Spotify</p>
        {music.connected ? (
          <div className="flex items-center justify-between py-2 text-sm text-white/70">
            Connected
            <button type="button" onClick={music.disconnect} className="text-xs text-white/40 hover:text-white/80">
              Disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!spotifyClientId}
            onClick={() => spotify.connect(spotifyClientId)}
            className="mt-2 w-full rounded-lg bg-white/[0.07] py-2 text-sm text-white/80 hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Connect Spotify
          </button>
        )}
        {music.error && <p className="mt-1.5 text-xs text-amber-200/60">{music.error}</p>}
        <details className="mt-2 text-[0.7rem] leading-relaxed text-white/30">
          <summary className="cursor-pointer hover:text-white/50">Use your own Spotify app</summary>
          <p className="mt-1.5">
            Spotify lets each personal app sign in only 5 accounts. If Connect fails, create an app at developer.spotify.com with
            redirect URI <code className="text-white/50">{ready ? `${location.origin}/` : ""}</code> and paste its Client ID:
          </p>
          <form
            key={prefs.spotifyClientId ?? ""}
            onSubmit={(e) => {
              e.preventDefault();
              const id = (new FormData(e.currentTarget).get("cid") as string).trim() || undefined;
              setPrefs((p) => ({ ...p, spotifyClientId: id }));
            }}
          >
            <input
              name="cid"
              type="text"
              inputMode="text"
              defaultValue={prefs.spotifyClientId}
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              placeholder="Client ID"
              autoComplete="off"
              spellCheck={false}
              className="mt-2 w-full rounded-lg bg-white/[0.05] px-3 py-2 font-mono text-xs text-white/80 outline-none placeholder:text-white/20 focus:ring-1 focus:ring-white/20"
            />
          </form>
        </details>
        <p className="mt-4 text-[0.7rem] leading-relaxed text-white/25">
          Everything stays on this device: settings in the browser, calendar sign-ins in an encrypted cookie. Nothing is stored on
          the server.{" "}
          <a href="/privacy" className="underline decoration-white/20 underline-offset-2 hover:text-white/60">
            Privacy
          </a>
        </p>
      </div>
      <div
        className={`flex h-full flex-col px-[max(5vw,1.25rem)] pt-[5vh] pb-[max(5vh,env(safe-area-inset-bottom))] transition-[transform,opacity] duration-[2s] ${ready ? "opacity-100" : "opacity-0"}`}
        style={{ transform: `translate(${dx}px, ${dy}px)` }}
      >
        <section className="flex flex-1 flex-col items-center justify-center">
          <button
            type="button"
            onClick={() => setPrefs(toggleHour12)}
            title="Switch 12h / 24h"
            className="clock-glow flex cursor-[inherit] items-end leading-[0.85] font-thin tracking-[-0.02em] text-[#ededea] tabular-nums outline-none"
            style={{ fontSize: "min(30vw, 44vh)" }}
          >
            <span key={`${hh}${mm}`} className="fade">
              {hh}
              <span className="relative -top-[0.06em] px-[0.02em] text-[var(--accent)] opacity-45">:</span>
              {mm}
            </span>
            {/* AM/PM sits just above the seconds, both resting on the digits' baseline */}
            <span className="ml-[0.1em] flex flex-col items-start gap-[0.35em] pb-[0.11em] text-[0.12em] leading-none font-light tracking-[0.08em]">
              {hour12 && <span className="text-white/40">{h < 12 ? "AM" : "PM"}</span>}
              {show("seconds") && <span className="text-white/25">{ss}</span>}
            </span>
          </button>
          {show("date") && (
            <p className="mt-[3vh] text-center text-[clamp(1rem,2.4vw,2.8rem)] font-extralight tracking-wide text-white/45">{date}</p>
          )}
          {show("focus") && <FocusLine focus={focus} />}
          {agenda && (
            <p className={`mt-[1.6vh] flex max-w-full items-center gap-[0.6em] text-[clamp(0.9rem,1.5vw,1.7rem)] font-light ${dim}`}>
              <span className={`size-[0.4em] shrink-0 rounded-full bg-(--accent) ${agenda.soon ? "opacity-90" : "opacity-40"}`} />
              <span className={`truncate ${agenda.soon ? "text-white/80" : "text-white/55"}`}>{agenda.title}</span>
              <span className="shrink-0 text-white/30">{agenda.when}</span>
            </p>
          )}
          {music.track && (
            <div className={`mt-[1.4vh] flex max-w-full items-center gap-[0.7em] text-[clamp(0.85rem,1.3vw,1.5rem)] font-light ${dim}`}>
              {music.track.art && (
                // eslint-disable-next-line @next/next/no-img-element -- tiny remote cover; image optimization isn't worth it
                <img src={music.track.art} alt="" className={`size-[1.9em] shrink-0 rounded-[0.3em] ${music.track.playing ? "opacity-80" : "opacity-35"}`} />
              )}
              <a href={music.track.url} target="_blank" rel="noreferrer" className="min-w-0 truncate outline-none">
                <span className={music.track.playing ? "text-white/75" : "text-white/40"}>{music.track.title}</span>
                <span className="text-white/30"> · {music.track.artist}</span>
              </a>
              {/* controls fade out with the cursor; a tap brings them back */}
              <span className="flex shrink-0 items-center text-white/45 transition-opacity duration-700 group-data-idle:pointer-events-none group-data-idle:opacity-0">
                {(["previous", music.track.playing ? "pause" : "play", "next"] as const).map((cmd) => (
                  <button key={cmd} type="button" aria-label={cmd} onClick={() => music.send(cmd)} className="rounded-full p-[0.35em] outline-none hover:text-white/90 focus-visible:text-white/90">
                    <Icon name={cmd} className="size-[0.95em]" />
                  </button>
                ))}
              </span>
            </div>
          )}
        </section>

        {(["weather", "hours", "sun", "day"] as const).some(show) && (
        <footer className={`grid grid-cols-2 gap-x-[4vw] gap-y-[3vh] border-t border-white/[0.06] pt-[3.5vh] md:grid-flow-col md:grid-cols-none md:auto-cols-fr ${dim}`}>
          {/* weather */}
          {show("weather") && (
          <div className="min-w-0">
            <p className={label}>
              {data?.place.name ?? "Weather"}
              {stale && data && <span className="ml-2 normal-case tracking-normal text-amber-200/50">stale · {timeOf(data.at, hour12)}</span>}
            </p>
            {w ? (
              <>
                <div className={`${value} mt-2 flex items-center gap-3`}>
                  <Icon name={icon!} className="size-[1.15em] shrink-0 text-[var(--accent)]" />
                  <button type="button" onClick={() => setPrefs(toggleUnits)} title="Switch °C / °F" className="cursor-[inherit] outline-none">
                    {deg(w.temp)}
                  </button>
                  <span className="truncate text-[0.6em] text-white/45">{condText}</span>
                </div>
                <p className={`${sub} mt-1`}>
                  Feels {deg(w.feels)} · H {deg(w.hi)} L {deg(w.lo)}
                </p>
              </>
            ) : (
              <p className={`${sub} mt-2`}>{failed ? "Weather unavailable" : "Locating…"}</p>
            )}
          </div>
          )}

          {/* next hours (full width under weather + sun on phones) */}
          {show("hours") && (
          <div className="order-3 col-span-2 md:order-none md:col-span-1">
            <p className={label}>Next hours</p>
            <div className="mt-2 grid grid-cols-6 gap-1">
              {hours.map(([x, c]) => (
                <div key={x} className="text-center">
                  <p className="text-[clamp(0.95rem,1.5vw,1.8rem)] font-light text-white/75">{deg(c)}</p>
                  <p className={sub}>{hourOf(x, hour12)}</p>
                </div>
              ))}
              {!hours.length && <p className={`${sub} col-span-6`}>—</p>}
            </div>
          </div>
          )}

          {/* sun */}
          {show("sun") && (
          <div>
            <p className={label}>Sun</p>
            <div className="mt-2 space-y-1">
              {(["sunrise", "sunset"] as const).map((k) => (
                <p key={k} className="flex items-center gap-2 text-[clamp(0.95rem,1.4vw,1.7rem)] font-light text-white/75">
                  <Icon name={k} className="size-[1em] text-white/35" />
                  {w ? timeOf(w[k], hour12) : "—"}
                </p>
              ))}
            </div>
          </div>
          )}

          {/* day progress */}
          {show("day") && (
          <div className="order-4 col-span-2 md:order-none md:col-span-1">
            <p className={label}>Day</p>
            <p className={`${value} mt-2`}>{dayPct}%</p>
            <div className="mt-3 h-[2px] w-full overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-[var(--accent)] opacity-60 transition-[width] duration-1000" style={{ width: `${dayPct}%` }} />
            </div>
          </div>
          )}
        </footer>
        )}
      </div>
    </main>
  );
}
