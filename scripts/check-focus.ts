// Run: node --experimental-strip-types scripts/check-focus.ts
import assert from "node:assert/strict";
import { EMPTY, MIN, elapsed, formatClock, formatTotal, pause, remaining, resume, start, stats, stop, tick } from "../app/focus.ts";

const noon = new Date(2026, 10, 20, 12, 0, 0).getTime(); // local noon, so nothing crosses midnight

// pause/resume: paused time doesn't count
let d = start(EMPTY, 25 * MIN, noon);
d = pause(d, noon + 10 * MIN);
assert.equal(remaining(d.active!, noon + 60 * MIN), 15 * MIN, "frozen while paused");
d = resume(d, noon + 20 * MIN);
assert.equal(elapsed(d.active!, noon + 20 * MIN), 10 * MIN);
assert.equal(tick(d, noon + 34 * MIN).event, null, "not done yet: 10m paused");

// focus ends → logged, 5-minute break starts exactly at the end
let r = tick(d, noon + 35 * MIN);
assert.equal(r.event?.kind, "focus-done");
assert.equal(r.event?.at, noon + 35 * MIN);
assert.deepEqual(r.data.log, [{ start: noon, ms: 25 * MIN, done: true }]);
assert.equal(r.data.active?.phase, "break");
assert.equal(r.data.active?.duration, 5 * MIN);

// tab closed for hours: focus and break both finish in one catch-up call
r = tick(start(EMPTY, 25 * MIN, noon), noon + 3 * 60 * MIN);
assert.equal(r.event?.kind, "break-done");
assert.equal(r.data.active, null);
assert.equal(r.data.log.length, 1);

// every 4th completed session of the day earns a 15-minute break
d = EMPTY;
for (let i = 0; i < 4; i++) {
  const t0 = noon + i * 40 * MIN;
  d = tick(start(d, 25 * MIN, t0), t0 + 25 * MIN).data;
  assert.equal(d.active?.duration, i === 3 ? 15 * MIN : 5 * MIN, `break after session ${i + 1}`);
  d = stop(d, t0 + 26 * MIN); // ending a break never logs anything
}
assert.equal(d.log.length, 4);

// stopping early: counted after a minute, ignored before
assert.equal(stop(start(EMPTY, 25 * MIN, noon), noon + 30_000).log.length, 0);
assert.deepEqual(stop(start(EMPTY, 25 * MIN, noon), noon + 12 * MIN).log, [{ start: noon, ms: 12 * MIN, done: false }]);

// open-ended sessions never end by themselves
d = start(EMPTY, null, noon);
assert.equal(tick(d, noon + 10 * 60 * MIN).event, null);
assert.equal(remaining(d.active!, noon), null);

// stats: live session counts toward today; streak spans days and survives an empty today
const day = 24 * 60 * MIN;
d = { ...EMPTY, log: [3, 2, 1].map((n) => ({ start: noon - n * day, ms: 30 * MIN, done: true })) };
let s = stats(d, noon);
assert.equal(s.streak, 3, "today empty: streak counts from yesterday");
assert.equal(s.today, 0);
d = start(d, 25 * MIN, noon);
s = stats(d, noon + 10 * MIN);
assert.equal(s.today, 10 * MIN, "live session included");
assert.equal(s.streak, 4);
assert.equal(s.week, 100 * MIN);
assert.equal(s.days.length, 7);
assert.ok(s.days[6].today && s.days[6].ms === 10 * MIN);
assert.equal(stats({ ...EMPTY, log: [{ start: noon - 2 * day, ms: 30 * MIN, done: true }] }, noon).streak, 0, "gap breaks it");

assert.equal(formatClock(18 * MIN + 42_000), "18:42");
assert.equal(formatClock(83 * MIN + 4_000), "1:23:04");
assert.equal(formatClock(500, true), "0:01", "countdown rounds up");
assert.equal(formatTotal(135 * MIN), "2h 15m");
assert.equal(formatTotal(45 * MIN), "45m");
console.log("focus ok");
