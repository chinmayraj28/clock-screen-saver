// Spotify via Authorization Code + PKCE, entirely in the browser: no client secret, no server.
// Tokens live in localStorage on this device only.

const KEY = "deskclock:spotify";
const PENDING = "deskclock:spotify-pending";
const SCOPES = "user-read-currently-playing user-read-playback-state user-modify-playback-state";

type Session = { clientId: string; access: string; refresh: string; expires: number };
export type NowPlaying = { title: string; artist: string; art?: string; url?: string; playing: boolean } | null;

const redirectUri = () => `${location.origin}/`;

function load(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}
function save(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {}
}

export const isConnected = () => !!load();
export const disconnect = () => save(null);

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function connect(clientId: string) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state, clientId }));
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
    state,
  });
  location.assign(`https://accounts.spotify.com/authorize?${q}`);
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || "Spotify sign-in failed");
  return json as { access_token: string; refresh_token?: string; expires_in: number };
}

/** Finish sign-in if Spotify just redirected back here. Returns an error message, or null. */
export async function finishConnect(): Promise<string | null> {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  if (!code && !error) return null;
  history.replaceState(null, "", url.pathname); // drop ?code= from the address bar right away

  const pending = JSON.parse(sessionStorage.getItem(PENDING) ?? "null");
  sessionStorage.removeItem(PENDING);
  if (error) return error === "access_denied" ? "Spotify access was declined" : `Spotify: ${error}`;
  if (!pending || pending.state !== state) return "Spotify sign-in expired, try again";

  try {
    const t = await tokenRequest({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: redirectUri(),
      client_id: pending.clientId,
      code_verifier: pending.verifier,
    });
    save({ clientId: pending.clientId, access: t.access_token, refresh: t.refresh_token!, expires: Date.now() + t.expires_in * 1000 });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

async function accessToken(force = false): Promise<string> {
  const s = load();
  if (!s) throw new Error("Not connected");
  if (!force && s.expires - Date.now() > 60_000) return s.access;
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refresh, client_id: s.clientId });
    save({ ...s, access: t.access_token, refresh: t.refresh_token ?? s.refresh, expires: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  } catch (e) {
    save(null); // refresh token revoked or expired: the user has to connect again
    throw e;
  }
}

async function api(path: string, init?: RequestInit, retried = false): Promise<Response> {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken(retried)}` },
  });
  if (res.status === 401 && !retried) return api(path, init, true);
  return res;
}

export async function nowPlaying(): Promise<NowPlaying> {
  const res = await api("/me/player/currently-playing?additional_types=episode");
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Spotify ${res.status}`);
  const { item, is_playing } = await res.json();
  if (!item) return null;
  const episode = item.type === "episode";
  const images: { url: string; width: number }[] = (episode ? item.images : item.album?.images) ?? [];
  return {
    title: item.name,
    artist: episode ? item.show?.name ?? "" : (item.artists ?? []).map((a: { name: string }) => a.name).join(", "),
    art: [...images].sort((a, b) => a.width - b.width).find((i) => i.width >= 64)?.url ?? images[0]?.url,
    url: item.external_urls?.spotify,
    playing: !!is_playing,
  };
}

export type Command = "play" | "pause" | "next" | "previous";

/** Returns an error message for the user, or null. */
export async function control(cmd: Command): Promise<string | null> {
  const res = await api(`/me/player/${cmd}`, { method: cmd === "next" || cmd === "previous" ? "POST" : "PUT" });
  if (res.ok) return null;
  if (res.status === 404) return "Open Spotify on a device first";
  if (res.status === 403) return "Playback control needs Spotify Premium";
  return `Spotify ${res.status}`;
}
