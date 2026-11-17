import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { PROVIDERS, cookieOptions, credentials, isProvider, pendingCookie, redirectUri, sessionCookie } from "../providers";
import { seal, unseal } from "../seal";

/** GET /api/connect/google → redirect to the provider's consent screen. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/connect/[provider]">) {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) return new Response("Unknown provider", { status: 404 });
  const creds = credentials(provider);
  if (!creds) return new Response(`${PROVIDERS[provider].label} isn't set up on this site yet`, { status: 501 });

  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const p = PROVIDERS[provider];
  const q = new URLSearchParams({
    client_id: creds.id,
    response_type: "code",
    redirect_uri: redirectUri(req.nextUrl.origin, provider),
    scope: p.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...p.extra,
  });

  const res = NextResponse.redirect(`${p.authorize}?${q}`);
  res.cookies.set(pendingCookie(provider), seal(pendingCookie(provider), { state, verifier }), cookieOptions(req, 600));
  return res;
}

/** POST /api/connect/google → forget the connection (and revoke it where the provider supports that). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/connect/[provider]">) {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) return new Response("Unknown provider", { status: 404 });

  const session = unseal<{ refresh: string }>(sessionCookie(provider), req.cookies.get(sessionCookie(provider))?.value);
  const revoke = PROVIDERS[provider].revoke;
  if (session && revoke) {
    await fetch(revoke, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: session.refresh }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {}); // best effort; the cookie goes either way
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(sessionCookie(provider));
  return res;
}
