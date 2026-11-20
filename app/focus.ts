// Focus timer: pure state transitions and stats. No React, no DOM, so scripts/check-focus.ts can test it.

export type Phase = "focus" | "break";
export type Active = {
  phase: Phase;
  start: number; // epoch ms
  duration: number | null; // ms; null = open-ended focus ("locked in" stopwatch)
  pausedAt: number | null;
  paused: number; // total paused ms so far
};
export type LogEntry = { start: number; ms: number; done: boolean }; // done = ran its full length
export type FocusData = { active: Active | null; log: LogEntry[]; preset: number | null; sound: boolean };
export type FocusEvent = { kind: "focus-done" | "break-done"; at: number };

export const MIN = 60_000;
export const PRESETS = [25 * MIN, 50 * MIN, 90 * MIN, null] as const;
const SHORT_BREAK = 5 * MIN;
const LONG_BREAK = 15 * MIN;
const LONG_BREAK_EVERY = 4; // every 4th completed session of the day
const MIN_LOGGED = MIN; // shorter attempts don't count
const KEEP_DAYS = 90;

export const EMPTY: FocusData = { active: null, log: [], preset: 25 * MIN, sound: true };

export const elapsed = (a: Active, now: number) => Math.max(0, (a.pausedAt ?? now) - a.start - a.paused);
export const remaining = (a: Active, now: number) => (a.duration == null ? null : Math.max(0, a.duration - elapsed(a, now)));
const endsAt = (a: Active) => a.start + a.paused + (a.duration ?? Infinity);

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const withLog = (log: LogEntry[], a: Active, ms: number, done: boolean) =>
  ms >= MIN_LOGGED ? [...log, { start: a.start, ms, done }] : log;

export function start(d: FocusData, duration: number | null, now: number): FocusData {
  return { ...d, preset: duration, active: { phase: "focus", start: now, duration, pausedAt: null, paused: 0 } };
}

export function pause(d: FocusData, now: number): FocusData {
  if (!d.active || d.active.pausedAt != null) return d;
  return { ...d, active: { ...d.active, pausedAt: now } };
}

export function resume(d: FocusData, now: number): FocusData {
  const a = d.active;
  if (!a || a.pausedAt == null) return d;
  return { ...d, active: { ...a, paused: a.paused + (now - a.pausedAt), pausedAt: null } };
}

/** Stop now. A focus session that ran at least a minute is still counted. */
export function stop(d: FocusData, now: number): FocusData {
  const a = d.active;
  if (!a) return d;
  return { ...d, active: null, log: a.phase === "focus" ? withLog(d.log, a, elapsed(a, now), false) : d.log };
}

/**
 * Move past any phase whose time is up: focus → break (logged), break → idle.
 * Loops so a tab that was closed for hours catches up in one call. Returns the latest event.
 */
export function tick(d: FocusData, now: number): { data: FocusData; event: FocusEvent | null } {
  let data = d;
  let event: FocusEvent | null = null;
  for (;;) {
    const a = data.active;
    if (!a || a.duration == null || a.pausedAt != null) break;
    const at = endsAt(a);
    if (at > now) break;
    if (a.phase === "focus") {
      const log = withLog(data.log, a, a.duration, true);
      const doneToday = log.filter((e) => e.done && dayKey(e.start) === dayKey(at)).length;
      const breakMs = doneToday % LONG_BREAK_EVERY === 0 ? LONG_BREAK : SHORT_BREAK;
      data = { ...data, log, active: { phase: "break", start: at, duration: breakMs, pausedAt: null, paused: 0 } };
      event = { kind: "focus-done", at };
    } else {
      data = { ...data, active: null };
      event = { kind: "break-done", at };
    }
  }
  return { data, event };
}

/** Drop log entries older than KEEP_DAYS so storage stays small. */
export const prune = (d: FocusData, now: number): FocusData => ({
  ...d,
  log: d.log.filter((e) => now - e.start < KEEP_DAYS * 24 * 3_600_000),
});

export type Stats = {
  today: number;
  sessionsToday: number;
  week: number;
  streak: number;
  days: { label: string; ms: number; today: boolean }[]; // last 7 days, oldest first
};

export function stats(d: FocusData, now: number): Stats {
  const live: LogEntry[] = d.active?.phase === "focus" ? [{ start: d.active.start, ms: elapsed(d.active, now), done: false }] : [];
  const byDay = new Map<string, number>();
  for (const e of [...d.log, ...live]) byDay.set(dayKey(e.start), (byDay.get(dayKey(e.start)) ?? 0) + e.ms);

  // walk calendar days at local noon, so DST changes never skip or repeat a day
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  const daysAgo = (n: number) => {
    const x = new Date(noon);
    x.setDate(noon.getDate() - n);
    return x;
  };

  const days = Array.from({ length: 7 }, (_, i) => {
    const day = daysAgo(6 - i);
    return {
      label: day.toLocaleDateString("en-GB", { weekday: "narrow" }),
      ms: byDay.get(dayKey(day.getTime())) ?? 0,
      today: i === 6,
    };
  });

  // a streak survives until the end of today: if nothing yet today, count from yesterday
  let streak = 0;
  for (let n = (byDay.get(dayKey(now)) ?? 0) >= MIN ? 0 : 1; n < 366; n++) {
    if ((byDay.get(dayKey(daysAgo(n).getTime())) ?? 0) < MIN) break;
    streak++;
  }

  return {
    today: days[6].ms,
    sessionsToday: d.log.filter((e) => dayKey(e.start) === dayKey(now)).length,
    week: days.reduce((sum, x) => sum + x.ms, 0),
    streak,
    days,
  };
}

/** 1h 05m, 45m, 0m */
export function formatTotal(ms: number) {
  const m = Math.floor(ms / MIN);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** 18:42 or 1:23:04 (rounds up, so a countdown never shows 0:00 while time is left) */
export function formatClock(ms: number, roundUp = false) {
  const s = roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
