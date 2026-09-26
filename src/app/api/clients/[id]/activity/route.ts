import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges } from "@/lib/changelog/record";
import { prisma } from "@/lib/prisma";
import { loadClientDetail } from "@/lib/clients/load";
import { qualifyClient } from "@/lib/clients/qualify";
import { logInfo } from "@/lib/logger";

// Notatka albo zapis rozmowy przy kliencie (zakładka „Komunikacja”, prompt
// 3B-karta) — LeadActivity bez sygnału, ta sama oś co na karcie sygnału.
// ADMIN/STAFF; AGENT — tylko notatka (nie dzwoni do klientów); KIEROWCA — 403.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const type = body?.type === "CALL" ? "CALL" : body?.type === "CALL_NO_ANSWER" ? "CALL_NO_ANSWER" : "NOTE";
  const isAgent = session.user.role === "AGENT";
  if (isAgent && type !== "NOTE") return NextResponse.json({ message: "Agent dodaje tylko notatki." }, { status: 403 });
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 5000) : "";
  if (!text && type !== "CALL_NO_ANSWER") return NextResponse.json({ message: "Wpisz treść notatki." }, { status: 400 });
  const exists = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ message: "Nie znaleziono klienta." }, { status: 404 });
  const activity = await prisma.leadActivity.create({ data: { clientId: id, type, body: text || null, userId: session.user.id } });
  if (isAgent) {
    await recordChanges(prisma, { userId: session.user.id }, [
      { entity: "NOTE", entityId: activity.id, clientId: id, operation: "CREATE", before: "null", after: toLogValue(text) },
    ]);
  }
  if (type === "CALL") await qualifyClient(id, "CALL");
  logInfo("client_activity_logged", { userId: session.user.id, clientId: id, type });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
