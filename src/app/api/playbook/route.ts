import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { loadPlaybook, savePlaybook } from "@/lib/leads/playbook-load";
import { logInfo } from "@/lib/logger";

// Ściąga (złote zasady obsługi zapytań): odczyt — biuro i agent; zapis — ADMIN
// (Ustawienia → Ściąga).
export async function GET() {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json({ playbook: await loadPlaybook() });
}

export async function PUT(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { playbook?: unknown } | null;
  const playbook = await savePlaybook(body?.playbook);
  logInfo("playbook_saved", { userId: session.user.id });
  return NextResponse.json({ playbook });
}
