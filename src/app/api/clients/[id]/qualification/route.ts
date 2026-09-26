import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { ADMIN_AND_AGENT } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges } from "@/lib/changelog/record";
import { loadClientDetail } from "@/lib/clients/load";
import { qualifyClient, unqualifyClient } from "@/lib/clients/qualify";
import { logInfo } from "@/lib/logger";

// Ręczna kwalifikacja / cofnięcie (prompt 2 v2, 1.0): tylko ADMIN, cofnięcie
// z powodem. Klient z wynajmem, historią albo fakturą zostaje klientem.
// AGENT: tylko „przenieś do klientów” (qualify), bez cofania. Obie operacje
// w dzienniku zmian.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(ADMIN_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (session.user.role === "AGENT" && body?.action !== "qualify") {
    return NextResponse.json({ message: "Agent może tylko przenieść kontakt do klientów." }, { status: 403 });
  }
  const before = await prisma.client.findUnique({ where: { id }, select: { qualifiedAt: true, qualifiedReason: true } });
  if (!before) return NextResponse.json({ message: "Nie znaleziono klienta." }, { status: 404 });
  if (body?.action === "qualify") {
    await qualifyClient(id, "MANUAL");
  } else if (body?.action === "unqualify") {
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!note) return NextResponse.json({ message: "Podaj powód cofnięcia." }, { status: 400 });
    await unqualifyClient(id, note);
  } else {
    return NextResponse.json({ message: "Nieznana akcja." }, { status: 400 });
  }
  const after = await prisma.client.findUnique({ where: { id }, select: { qualifiedAt: true, qualifiedReason: true } });
  await recordChanges(prisma, { userId: session.user.id }, [
    {
      entity: "CLIENT",
      entityId: id,
      clientId: id,
      operation: body.action === "qualify" ? "QUALIFY" : "UNQUALIFY",
      field: "qualifiedAt",
      before: toLogValue(before),
      after: toLogValue(after),
    },
  ]);
  logInfo("client_qualification_changed", { userId: session.user.id, clientId: id, action: body.action });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
