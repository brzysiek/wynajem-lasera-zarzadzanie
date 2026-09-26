import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { loadClientDetail } from "@/lib/clients/load";
import { qualifyClient } from "@/lib/clients/qualify";
import { logInfo } from "@/lib/logger";

// Notatka albo zapis rozmowy przy kliencie (zakładka „Komunikacja”, prompt
// 3B-karta) — LeadActivity bez sygnału, ta sama oś co na karcie sygnału.
// ADMIN/STAFF; KIEROWCA — 403.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const type = body?.type === "CALL" ? "CALL" : body?.type === "CALL_NO_ANSWER" ? "CALL_NO_ANSWER" : "NOTE";
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 5000) : "";
  if (!text && type !== "CALL_NO_ANSWER") return NextResponse.json({ message: "Wpisz treść notatki." }, { status: 400 });
  const exists = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ message: "Nie znaleziono klienta." }, { status: 404 });
  await prisma.leadActivity.create({ data: { clientId: id, type, body: text || null, userId: session.user.id } });
  if (type === "CALL") await qualifyClient(id, "CALL");
  logInfo("client_activity_logged", { userId: session.user.id, clientId: id, type });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
