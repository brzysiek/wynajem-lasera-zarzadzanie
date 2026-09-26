import { NextRequest, NextResponse } from "next/server";
import { OAuthError, registerClient } from "@/lib/oauth/server";
import { logInfo } from "@/lib/logger";

// Dynamiczna rejestracja klienta OAuth (RFC 7591) — publiczna z definicji,
// ale przyjmuje tylko adresy powrotu Claude. Sama rejestracja nie daje
// żadnego dostępu: token wydaje dopiero zgoda zalogowanego ADMIN.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_client_metadata", error_description: "Treść musi być JSON." }, { status: 400 });
  try {
    const client = await registerClient(body);
    logInfo("oauth_client_registered", { clientId: client.client_id, name: client.client_name ?? null });
    return NextResponse.json(client, { status: 201 });
  } catch (err) {
    if (err instanceof OAuthError) return NextResponse.json({ error: err.code, error_description: err.message }, { status: err.status });
    throw err;
  }
}
