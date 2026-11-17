import { NextResponse, type NextRequest } from "next/server";
import { PROVIDERS, SESSION_MAX_AGE, cookieOptions, isProvider, pendingCookie, redirectUri, sessionCookie, tokenRequest } from "../../providers";
import { seal, unseal } from "../../seal";

/** GET /api/connect/google/callback?code=…&state=… → store the refresh token, back to the clock. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/connect/[provider]/callback">) {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) return new Response("Unknown provider", { status: 404 });

  const back = (query: Record<string, string>) => {
    const res = NextResponse.redirect(new URL(`/?${new URLSearchParams(query)}`, req.nextUrl.origin));
    res.cookies.delete(pendingCookie(provider));
    return res;
  };
  const fail = (message: string) => back({ calendar_error: message });

  const params = req.nextUrl.searchParams;
  if (params.get("error")) {
    return fail(params.get("error") === "access_denied" ? `${PROVIDERS[provider].label} access was declined` : `${PROVIDERS[provider].label}: ${params.get("error")}`);
  }

  const pending = unseal<{ state: string; verifier: string }>(pendingCookie(provider), req.cookies.get(pendingCookie(provider))?.value);
  const code = params.get("code");
  if (!pending || !code || pending.state !== params.get("state")) return fail("Sign-in expired, try again");

  try {
    const t = await tokenRequest(provider, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(req.nextUrl.origin, provider),
      code_verifier: pending.verifier,
    });
    if (!t.refresh_token) return fail(`${PROVIDERS[provider].label} didn't allow offline access, try again`);

    const res = back({ calendar: provider });
    res.cookies.set(sessionCookie(provider), seal(sessionCookie(provider), { refresh: t.refresh_token }), cookieOptions(req, SESSION_MAX_AGE));
    return res;
  } catch (e) {
    return fail((e as Error).message);
  }
}
