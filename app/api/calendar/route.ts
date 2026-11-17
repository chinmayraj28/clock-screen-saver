import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { upcoming } from "./ics";

// Server-side proxy because calendar feeds don't send CORS headers.
// The feed URL is a secret, so it travels in the POST body (never the query string / logs).

const MAX_BYTES = 5_000_000;
const MAX_REDIRECTS = 3;

function isPrivate(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivate(v.slice(7)); // IPv4-mapped IPv6
  if (v.includes(":")) return v === "::" || v === "::1" || /^(fc|fd|fe[89ab])/.test(v);
  const [a, b] = v.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

// ponytail: checks DNS before connecting; a DNS-rebinding race is still possible. Pin the resolved IP if that matters.
async function assertPublic(url: URL) {
  if (url.protocol !== "https:") throw new Error("Use an https:// or webcal:// address");
  if (url.port && url.port !== "443") throw new Error("Only the standard https port is allowed");
  if (url.username || url.password) throw new Error("Addresses with credentials aren't allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivate)) throw new Error("That address isn't reachable from here");
}

async function fetchFeed(raw: string): Promise<string> {
  let url = new URL(raw.trim().replace(/^webcal:/i, "https:"));
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual", // every hop gets re-checked
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "text/calendar, */*;q=0.5" },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`Calendar server replied ${res.status}`);

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Calendar is too large (over 5 MB)");
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That address doesn't return an iCal feed");
    return text;
  }
  throw new Error("Too many redirects");
}

export async function POST(req: Request) {
  let url: unknown;
  try {
    ({ url } = await req.json());
  } catch {}
  if (typeof url !== "string" || url.length > 2048) return Response.json({ error: "Missing calendar address" }, { status: 400 });

  try {
    const events = upcoming(await fetchFeed(url), Date.now());
    return Response.json({ events }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof TypeError && e.message === "Invalid URL" ? "That isn't a valid address" : (e as Error).message;
    return Response.json({ error: message || "Couldn't load calendar" }, { status: 400 });
  }
}
