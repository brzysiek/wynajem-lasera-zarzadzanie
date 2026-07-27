import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { setEnvValue, triggerRestart } from "@/lib/env-file";
import { logInfo } from "@/lib/logger";

// SzybkiSMS API Access Tokens are opaque alphanumeric strings — this guards
// against writing a value that could break the .env line (newlines, `=`, etc.).
const TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/;

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";

  if (!token || !TOKEN_PATTERN.test(token)) {
    return NextResponse.json({ message: "Nieprawidłowy format tokenu." }, { status: 400 });
  }

  setEnvValue("SZYBKISMS_API_TOKEN", token);
  triggerRestart();
  logInfo("integration_szybkisms_token_saved", { userId: session.user.id });

  return NextResponse.json({ message: "Zapisano. Aplikacja restartuje się — odczekaj kilka sekund przed testem." });
}

export async function DELETE() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  setEnvValue("SZYBKISMS_API_TOKEN", "");
  triggerRestart();
  logInfo("integration_szybkisms_token_removed", { userId: session.user.id });

  return NextResponse.json({ message: "Token usunięty. Aplikacja restartuje się." });
}
