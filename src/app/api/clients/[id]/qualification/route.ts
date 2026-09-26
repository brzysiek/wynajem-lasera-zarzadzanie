import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { loadClientDetail } from "@/lib/clients/load";
import { qualifyClient, unqualifyClient } from "@/lib/clients/qualify";
import { logInfo } from "@/lib/logger";

// Ręczna kwalifikacja / cofnięcie (prompt 2 v2, 1.0): tylko ADMIN, cofnięcie
// z powodem. Klient z wynajmem, historią albo fakturą zostaje klientem.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (body?.action === "qualify") {
    await qualifyClient(id, "MANUAL");
  } else if (body?.action === "unqualify") {
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!note) return NextResponse.json({ message: "Podaj powód cofnięcia." }, { status: 400 });
    await unqualifyClient(id, note);
  } else {
    return NextResponse.json({ message: "Nieznana akcja." }, { status: 400 });
  }
  logInfo("client_qualification_changed", { userId: session.user.id, clientId: id, action: body.action });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
