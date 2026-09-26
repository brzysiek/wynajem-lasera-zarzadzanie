import { NextRequest, NextResponse } from "next/server";
import { OAuthError, exchangeCode, refreshToken } from "@/lib/oauth/server";
import { logError, logInfo } from "@/lib/logger";

// Endpoint tokenu OAuth (RFC 6749): authorization_code (+ PKCE S256) i
// refresh_token (z rotacją). Treść: application/x-www-form-urlencoded.
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export async function POST(req: NextRequest) {
  const type = req.headers.get("content-type") ?? "";
  const form = type.includes("application/json")
    ? new URLSearchParams(Object.entries(((await req.json().catch(() => ({}))) ?? {}) as Record<string, string>))
    : new URLSearchParams(await req.text());
  const grant = form.get("grant_type");
  try {
    if (grant === "authorization_code") {
      const r = await exchangeCode(form);
      logInfo("oauth_token_issued", { clientId: form.get("client_id") });
      return NextResponse.json(r, { headers: NO_STORE });
    }
    if (grant === "refresh_token") return NextResponse.json(await refreshToken(form), { headers: NO_STORE });
    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400, headers: NO_STORE });
  } catch (err) {
    if (err instanceof OAuthError) return NextResponse.json({ error: err.code, error_description: err.message }, { status: err.status, headers: NO_STORE });
    logError("oauth_token_failed", err, { grant });
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}
