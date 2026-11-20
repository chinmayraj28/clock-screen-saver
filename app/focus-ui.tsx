"use client";

import { useEffect, useRef, useState } from "react";
import * as F from "./focus";

const KEY = "deskclock:focus";

function load(): F.FocusData {
  try {
    return { ...F.EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? "null") };
  } catch {
    return F.EMPTY;
  }
}

/** Two soft sine notes: rising when focus ends, falling when the break ends. */
function chime(ctx: AudioContext | null, kind: F.FocusEvent["kind"]) {
  if (!ctx) return;
  ctx.resume().catch(() => {});
  (kind === "focus-done" ? [660, 880] : [880, 660]).forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + i * 0.35;
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.16, t0 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 1.5);
  });
}

export function useFocus(t: number) {
  const [data, setData] = useState<F.FocusData | null>(null); // null until loaded from storage
  const audio = useRef<AudioContext | null>(null);
  const baseTitle = useRef("");

  useEffect(() => {
    baseTitle.current = document.title;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setData(F.prune(load(), Date.now()));
    // browsers only allow audio after a gesture: unlock it on the first tap/click
    const unlock = () => (audio.current ??= new AudioContext());
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!data) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
  }, [data]);

  // advance finished phases on every clock tick (and catch up after a reload)
  useEffect(() => {
    if (!data || !t) return;
    const { data: next, event } = F.tick(data, t);
    if (next === data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- driven by the external clock
    setData(next);
    if (event && data.sound && t - event.at < 60_000) chime(audio.current, event.kind); // no chime for stale catch-ups
  }, [t, data]);

  const active = data?.active ?? null;
  const left = active && t ? F.remaining(active, t) : null;
  const spent = active && t ? F.elapsed(active, t) : 0;

  // the tab title doubles as a countdown when the clock isn't in front
  useEffect(() => {
    if (!baseTitle.current) return;
    const phase = active?.pausedAt != null ? "Paused" : active?.phase === "break" ? "Break" : "Focus";
    document.title = active ? `${F.formatClock(left ?? spent, left != null)} · ${phase}` : baseTitle.current;
  }, [active, left, spent]);

  const update = (fn: (d: F.FocusData, now: number) => F.FocusData) => setData((d) => d && fn(d, Date.now()));

  return {
    loaded: !!data,
    active,
    left,
    spent,
    preset: data?.preset ?? F.EMPTY.preset,
    sound: data?.sound ?? true,
    stats: data && t ? F.stats(data, t) : null,
    focusing: active?.phase === "focus" && active.pausedAt == null,
    start: (duration: number | null) => {
      audio.current ??= new AudioContext();
      update((d, now) => F.start(d, duration, now));
    },
    pause: () => update(F.pause),
    resume: () => update(F.resume),
    stop: () => update(F.stop),
    toggleSound: () => setData((d) => d && { ...d, sound: !d.sound }),
  };
}

export type Focus = ReturnType<typeof useFocus>;

/** The quiet line under the date while a session or break is running. */
export function FocusLine({ focus }: { focus: Focus }) {
  const a = focus.active;
  if (!a) return null;
  const paused = a.pausedAt != null;
  const label = paused ? "Paused" : a.phase === "break" ? "Break" : a.duration == null ? "Locked in" : "Focus";
  const time = F.formatClock(focus.left ?? focus.spent, focus.left != null);
  const progress = a.duration ? 1 - (focus.left ?? 0) / a.duration : null;

  return (
    <button
      type="button"
      popoverTarget="focus"
      className="mt-[1.6vh] flex flex-col items-center gap-[0.5em] text-[clamp(0.9rem,1.5vw,1.7rem)] font-light outline-none"
    >
      <span className="flex items-center gap-[0.6em]">
        <span className={paused ? "text-white/35" : a.phase === "break" ? "text-white/50" : "text-(--accent)/80"}>{label}</span>
        <span className={`tabular-nums ${paused ? "text-white/35" : "text-white/75"}`}>{time}</span>
      </span>
      {progress != null && (
        <span className="h-[2px] w-[9em] overflow-hidden rounded-full bg-white/[0.07]">
          <span
            className={`block h-full rounded-full transition-[width] duration-1000 ease-linear ${a.phase === "break" ? "bg-white/30" : "bg-(--accent)/60"}`}
            style={{ width: `${progress * 100}%` }}
          />
        </span>
      )}
    </button>
  );
}

const sectionLabel = "text-[0.7rem] font-medium uppercase tracking-[0.18em] text-white/30";
const button = "rounded-lg px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/30";

/** Popover: pick a length and start, control the running session, see today/week/streak. */
export function FocusPanel({ focus }: { focus: Focus }) {
  const a = focus.active;
  const s = focus.stats;
  const max = Math.max(...(s?.days.map((d) => d.ms) ?? [0]), F.MIN);

  return (
    <div
      id="focus"
      popover="auto"
      className="inset-auto top-14 left-4 m-0 max-h-[calc(100dvh-4.5rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-white/10 bg-[#121214]/95 px-5 py-4 text-white shadow-2xl backdrop-blur"
    >
      <p className={sectionLabel}>Focus</p>

      {a ? (
        <div className="mt-3">
          <p className="text-sm text-white/45">
            {a.phase === "break" ? "Break" : a.duration == null ? "Locked in for" : "Focus"}
            {a.pausedAt != null && " · paused"}
          </p>
          <p className="mt-1 text-5xl font-extralight tracking-tight text-[#ededea] tabular-nums">
            {F.formatClock(focus.left ?? focus.spent, focus.left != null)}
          </p>
          <div className="mt-4 flex gap-2">
            {a.phase === "focus" &&
              (a.pausedAt != null ? (
                <button type="button" onClick={focus.resume} className={`${button} flex-1 bg-(--accent)/25 text-white/90 hover:bg-(--accent)/35`}>
                  Resume
                </button>
              ) : (
                <button type="button" onClick={focus.pause} className={`${button} flex-1 bg-white/[0.07] text-white/80 hover:bg-white/[0.12]`}>
                  Pause
                </button>
              ))}
            <button type="button" onClick={focus.stop} className={`${button} flex-1 bg-white/[0.04] text-white/55 hover:bg-white/[0.1] hover:text-white/80`}>
              {a.phase === "break" ? "Skip break" : "Stop"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <div className="grid grid-cols-4 gap-1.5">
            {F.PRESETS.map((p) => (
              <button
                key={p ?? "open"}
                type="button"
                onClick={() => focus.start(p)}
                className={`${button} px-0 ${focus.preset === p ? "bg-(--accent)/25 text-white/90" : "bg-white/[0.05] text-white/60 hover:bg-white/[0.1]"}`}
              >
                {p == null ? "∞" : `${p / F.MIN}m`}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => focus.start(focus.preset)}
            className={`${button} mt-2 w-full bg-(--accent)/25 text-white/90 hover:bg-(--accent)/35`}
          >
            Start {focus.preset == null ? "open-ended" : `${focus.preset / F.MIN} min`} focus
          </button>
          <p className="mt-2 text-[0.7rem] leading-relaxed text-white/30">
            Breaks start on their own: 5 min, or 15 after every 4th session. ∞ counts up until you stop.
          </p>
        </div>
      )}

      {s && (
        <>
          <div className="my-4 border-t border-white/[0.06]" />
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Today", F.formatTotal(s.today), `${s.sessionsToday} session${s.sessionsToday === 1 ? "" : "s"}`],
              ["This week", F.formatTotal(s.week), "last 7 days"],
              ["Streak", `${s.streak}`, s.streak === 1 ? "day" : "days"],
            ].map(([name, big, small]) => (
              <div key={name}>
                <p className="text-[0.65rem] uppercase tracking-[0.14em] text-white/30">{name}</p>
                <p className="mt-1 text-lg font-light text-white/85 tabular-nums">{big}</p>
                <p className="text-[0.7rem] text-white/30">{small}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex h-14 items-end gap-1.5" aria-label="Focus time over the last 7 days">
            {s.days.map((d, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1" title={`${F.formatTotal(d.ms)}`}>
                <div className="flex h-10 w-full items-end">
                  <div
                    className={`w-full rounded-sm ${d.today ? "bg-(--accent)/60" : "bg-white/15"}`}
                    style={{ height: d.ms ? `${Math.max(8, (d.ms / max) * 100)}%` : "2px" }}
                  />
                </div>
                <span className={`text-[0.6rem] ${d.today ? "text-white/60" : "text-white/25"}`}>{d.label}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="my-4 border-t border-white/[0.06]" />
      <label className="flex cursor-pointer items-center justify-between text-sm text-white/60">
        Chime when a phase ends
        <input type="checkbox" checked={focus.sound} onChange={focus.toggleSound} className="peer sr-only" />
        <span className="relative h-5 w-9 shrink-0 rounded-full bg-white/10 transition-colors peer-checked:bg-(--accent)/60 peer-focus-visible:ring-2 peer-focus-visible:ring-white/40 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white/90 after:transition-transform peer-checked:after:translate-x-4" />
      </label>
      <p className="mt-3 text-[0.7rem] text-white/25">History stays in this browser. Press P to open this panel.</p>
    </div>
  );
}
