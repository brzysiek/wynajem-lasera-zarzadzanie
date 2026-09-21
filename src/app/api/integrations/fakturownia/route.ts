import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { setEnvValue, triggerRestart } from "@/lib/env-file";
import { logInfo, logWarn } from "@/lib/logger";

// Token Fakturowni to losowy ciąg znaków+cyfr+podkreśleń/myślników (np.
// Eh6k00_cS2Eaw3p5MljI) — wzorzec też chroni przed zapisaniem czegoś, co
// zepsułoby linię w .env (nowe linie, `=`, itp.).
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
// Subdomena konta (https://{account}.fakturownia.pl) — standardowa etykieta DNS.
const ACCOUNT_PATTERN = /^[A-Za-z0-9-]+$/;

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const account = typeof body?.account === "string" ? body.account.trim() : "";
  const departmentIdRaw = typeof body?.departmentId === "string" ? body.departmentId.trim() : "";
  const departmentId = Number(departmentIdRaw);

  if (!token || !TOKEN_PATTERN.test(token)) {
    logWarn("integration_fakturownia_token_rejected", { userId: session.user.id });
    return NextResponse.json({ message: "Nieprawidłowy format tokenu." }, { status: 400 });
  }
  if (!account || !ACCOUNT_PATTERN.test(account)) {
    logWarn("integration_fakturownia_account_rejected", { userId: session.user.id });
    return NextResponse.json({ message: "Nieprawidłowa nazwa konta (subdomena)." }, { status: 400 });
  }
  if (!departmentIdRaw || !Number.isInteger(departmentId) || departmentId <= 0) {
    logWarn("integration_fakturownia_department_rejected", { userId: session.user.id });
    return NextResponse.json({ message: "Nieprawidłowe ID działu (liczba całkowita > 0)." }, { status: 400 });
  }

  setEnvValue("FAKTUROWNIA_API_TOKEN", token);
  setEnvValue("FAKTUROWNIA_ACCOUNT", account);
  setEnvValue("FAKTUROWNIA_DEPARTMENT_ID", String(departmentId));
  triggerRestart();
  logInfo("integration_fakturownia_credentials_saved", { userId: session.user.id, account });

  return NextResponse.json({ message: "Zapisano. Aplikacja restartuje się — odczekaj kilka sekund przed testem." });
}

export async function DELETE() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  setEnvValue("FAKTUROWNIA_API_TOKEN", "");
  setEnvValue("FAKTUROWNIA_ACCOUNT", "");
  setEnvValue("FAKTUROWNIA_DEPARTMENT_ID", "");
  triggerRestart();
  logInfo("integration_fakturownia_credentials_removed", { userId: session.user.id });

  return NextResponse.json({ message: "Dane dostępowe usunięte. Aplikacja restartuje się." });
}
