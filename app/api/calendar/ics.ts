import ICAL from "ical.js";

export type CalEvent =
  | { title: string; allDay: false; start: number; end: number } // epoch ms
  | { title: string; allDay: true; startDay: string; endDay: string }; // YYYY-MM-DD, end exclusive

const HOUR = 3_600_000;
const MAX_OCCURRENCES = 20_000; // per recurring series; expansion always starts at the series' first DTSTART

const day = (t: ICAL.Time) => `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;

/** Events overlapping [now, now + windowHours], sorted by start. All-day events come back as calendar dates. */
export function upcoming(ics: string, now: number, windowHours = 36): CalEvent[] {
  const cal = new ICAL.Component(ICAL.parse(ics));
  // ponytail: TimezoneService is process-global; feeds re-register the same IANA zones, so sharing is fine
  for (const tz of cal.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

  const masters = new Map<string, ICAL.Event>();
  const singles: ICAL.Event[] = [];
  const exceptions: ICAL.Event[] = [];
  for (const v of cal.getAllSubcomponents("vevent")) {
    if (v.getFirstPropertyValue("status") === "CANCELLED") continue;
    const e = new ICAL.Event(v);
    if (e.isRecurrenceException()) exceptions.push(e);
    else if (e.isRecurring()) masters.set(e.uid, e);
    else singles.push(e);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else singles.push(ex);
  }

  const to = now + windowHours * HOUR;
  const utcDay = (ms: number) => day(ICAL.Time.fromJSDate(new Date(ms), true));
  // all-day events are dates, not instants: keep a ±1 day margin and let the browser match its local date
  const firstDay = utcDay(now - 24 * HOUR);
  const lastDay = utcDay(to);
  const out: CalEvent[] = [];
  const add = (title: string, s: ICAL.Time, e: ICAL.Time | null) => {
    if (s.isDate) {
      let end = e;
      if (!end || end.compare(s) <= 0) {
        end = s.clone();
        end.adjust(1, 0, 0, 0); // no/zero-length DTEND = a single day
      }
      const startDay = day(s);
      const endDay = day(end);
      if (endDay > firstDay && startDay <= lastDay) out.push({ title, allDay: true, startDay, endDay });
      return;
    }
    const start = s.toUnixTime() * 1000;
    const end = (e ?? s).toUnixTime() * 1000;
    if (end > now && start < to) out.push({ title, allDay: false, start, end });
  };

  for (const e of singles) {
    try {
      add(e.summary || "Busy", e.startDate, e.endDate);
    } catch {}
  }
  for (const e of masters.values()) {
    try {
      const it = e.iterator();
      for (let i = 0, next; i < MAX_OCCURRENCES && (next = it.next()); i++) {
        if (next.toUnixTime() * 1000 > to) break;
        const o = e.getOccurrenceDetails(next);
        if (o.item.component.getFirstPropertyValue("status") === "CANCELLED") continue;
        add(o.item.summary || "Busy", o.startDate, o.endDate);
      }
    } catch {}
  }

  const key = (x: CalEvent) => (x.allDay ? Date.parse(x.startDay) : x.start);
  return out.sort((a, b) => key(a) - key(b)).slice(0, 25);
}
