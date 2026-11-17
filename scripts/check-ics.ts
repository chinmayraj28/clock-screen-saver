// Run: node --experimental-strip-types scripts/check-ics.ts
import assert from "node:assert/strict";
import { upcoming } from "../app/api/calendar/ics.ts";

const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:standup
SUMMARY:Standup
DTSTART;TZID=America/New_York:20260101T090000
DTEND;TZID=America/New_York:20260101T091500
RRULE:FREQ=DAILY
EXDATE;TZID=America/New_York:20261118T090000
END:VEVENT
BEGIN:VEVENT
UID:standup
RECURRENCE-ID;TZID=America/New_York:20261117T090000
SUMMARY:Standup (moved)
DTSTART;TZID=America/New_York:20261117T130000
DTEND;TZID=America/New_York:20261117T131500
END:VEVENT
BEGIN:VEVENT
UID:lunch
SUMMARY:Lunch
DTSTART:20261117T170000Z
DTEND:20261117T180000Z
END:VEVENT
BEGIN:VEVENT
UID:gone
SUMMARY:Cancelled thing
STATUS:CANCELLED
DTSTART:20261117T190000Z
DTEND:20261117T200000Z
END:VEVENT
BEGIN:VEVENT
UID:past
SUMMARY:Already over
DTSTART:20261117T080000Z
DTEND:20261117T090000Z
END:VEVENT
BEGIN:VEVENT
UID:holiday
SUMMARY:Holiday
DTSTART;VALUE=DATE:20261117
DTEND;VALUE=DATE:20261118
END:VEVENT
END:VCALENDAR`;

const now = Date.UTC(2026, 10, 17, 12); // Tue 17 Nov 2026 12:00Z = 07:00 New York (EST, -5)
const events = upcoming(ics, now);
const titles = events.map((e) => e.title);

assert.deepEqual(titles, ["Holiday", "Lunch", "Standup (moved)"]);
const moved = events.find((e) => e.title === "Standup (moved)");
assert.ok(moved && !moved.allDay && moved.start === Date.UTC(2026, 10, 17, 18), "exception moved to 13:00 EST = 18:00Z");
// 17th is replaced by the exception, 18th is EXDATE'd, so the next plain standup is the 19th 09:00 EST = 14:00Z...
// ...which is outside the 36h window. Widen it to check the EXDATE + timezone math:
const wide = upcoming(ics, now, 60).filter((e) => e.title === "Standup");
assert.ok(wide.length === 1 && !wide[0].allDay && wide[0].start === Date.UTC(2026, 10, 19, 14), "EXDATE skips the 18th");
assert.ok(!titles.includes("Cancelled thing") && !titles.includes("Already over"));
const holiday = events[0];
assert.ok(holiday.allDay && holiday.startDay === "2026-11-17" && holiday.endDay === "2026-11-18");
console.log("ics ok");
