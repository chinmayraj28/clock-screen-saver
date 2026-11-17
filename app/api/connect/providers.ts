import type { CalEvent } from "../calendar/ics";

// Google Calendar and Microsoft (Outlook / Microsoft 365) via OAuth authorization code + PKCE,
// with the client secret kept on the server. Only the refresh token is kept, sealed in an httpOnly cookie.

export const PROVIDERS = {
  google: {
    label: "Google Calendar",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    revoke: "https://oauth2.googleapis.com/revoke",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    // offline + consent: Google only returns a refresh token on a fresh consent
    extra: { access_type: "offline", prompt: "consent" } as Record<string, string>,
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  microsoft: {
    label: "Outlook",
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    revoke: null,
    scope: "offline_access Calendars.Read",
    extra: { prompt: "select_account" } as Record<string, string>,
    env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
  },
} as const;

export type ProviderName = keyof typeof PROVIDERS;
export const PROVIDER_NAMES = Object.keys(PROVIDERS) as ProviderName[];
export const isProvider = (p: string): p is ProviderName => Object.hasOwn(PROVIDERS, p);

export const SESSION_MAX_AGE = 400 * 24 * 3600; // browsers cap cookie lifetime at 400 days

export const cookieOptions = (req: { nextUrl: URL }, maxAge: number) => ({
  httpOnly: true,
  secure: req.nextUrl.protocol === "https:",
  sameSite: "lax" as const, // must survive the top-level redirect back from the provider
  path: "/",
  maxAge,
});

export const sessionCookie = (p: ProviderName) => `cal_${p}`;
export const pendingCookie = (p: ProviderName) => `oauth_${p}`;
export const redirectUri = (origin: string, p: ProviderName) => `${origin}/api/connect/${p}/callback`;

export function credentials(p: ProviderName) {
  const [id, secret] = PROVIDERS[p].env.map((k) => process.env[k]);
  // without a cookie secret there's nowhere safe to keep the connection, so treat the provider as off
  return id && secret && (process.env.COOKIE_SECRET?.length ?? 0) >= 32 ? { id, secret } : null;
}

export class OAuthError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

export async function tokenRequest(p: ProviderName, body: Record<string, string>) {
  const c = credentials(p);
  if (!c) throw new OAuthError(`${PROVIDERS[p].label} isn't set up on this site`);
  const res = await fetch(PROVIDERS[p].token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...body }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new OAuthError(json.error_description || json.error || `${PROVIDERS[p].label} sign-in failed`, json.error);
  return json as { access_token: string; refresh_token?: string; expires_in: number };
}

/** Swap a refresh token for an access token. Microsoft rotates refresh tokens, so the new one is returned too. */
export async function refresh(p: ProviderName, refreshToken: string) {
  const t = await tokenRequest(p, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    ...(p === "microsoft" ? { scope: PROVIDERS.microsoft.scope } : {}),
  });
  return { access: t.access_token, refresh: t.refresh_token ?? refreshToken };
}

async function getJSON(url: string, access: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${access}`, ...headers },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Calendar API replied ${res.status}`);
  return res.json();
}

type GoogleEvent = {
  status?: string;
  summary?: string;
  eventType?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

async function googleEvents(access: string, from: Date, to: Date): Promise<CalEvent[]> {
  const list = await getJSON("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader", access);
  // the calendars ticked in Google Calendar's sidebar
  const calendars: { id: string }[] = (list.items ?? []).filter((c: { selected?: boolean; hidden?: boolean }) => c.selected && !c.hidden).slice(0, 10);
  const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: "50" });

  const perCalendar = await Promise.all(
    calendars.map((c) =>
      getJSON(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?${q}`, access)
        .then((r) => (r.items ?? []) as GoogleEvent[])
        .catch(() => []), // one unreadable calendar shouldn't hide the rest
    ),
  );

  return perCalendar.flat().flatMap((e): CalEvent[] => {
    if (e.status === "cancelled" || e.eventType === "workingLocation") return [];
    if (e.attendees?.find((a) => a.self)?.responseStatus === "declined") return [];
    const title = e.summary || "Busy";
    if (e.start.date) return [{ title, allDay: true, startDay: e.start.date, endDay: e.end.date ?? e.start.date }];
    return [{ title, allDay: false, start: Date.parse(e.start.dateTime!), end: Date.parse(e.end.dateTime!) }];
  });
}

type GraphEvent = {
  subject?: string;
  isAllDay: boolean;
  isCancelled: boolean;
  responseStatus?: { response?: string };
  start: { dateTime: string };
  end: { dateTime: string };
};

async function microsoftEvents(access: string, from: Date, to: Date): Promise<CalEvent[]> {
  const q = new URLSearchParams({
    startDateTime: from.toISOString(),
    endDateTime: to.toISOString(),
    $select: "subject,start,end,isAllDay,isCancelled,responseStatus",
    $orderby: "start/dateTime",
    $top: "50",
  });
  // without a Prefer: outlook.timezone header, Graph returns times in UTC (with no "Z" suffix)
  const r = await getJSON(`https://graph.microsoft.com/v1.0/me/calendarView?${q}`, access);
  return ((r.value ?? []) as GraphEvent[]).flatMap((e): CalEvent[] => {
    if (e.isCancelled || e.responseStatus?.response === "declined") return [];
    const title = e.subject || "Busy";
    if (e.isAllDay) return [{ title, allDay: true, startDay: e.start.dateTime.slice(0, 10), endDay: e.end.dateTime.slice(0, 10) }];
    return [{ title, allDay: false, start: Date.parse(`${e.start.dateTime}Z`), end: Date.parse(`${e.end.dateTime}Z`) }];
  });
}

export function providerEvents(p: ProviderName, access: string, from: Date, to: Date) {
  return p === "google" ? googleEvents(access, from, to) : microsoftEvents(access, from, to);
}
