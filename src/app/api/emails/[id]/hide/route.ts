import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { loadClientDetail } from "@/lib/clients/load";
import { setThreadHidden } from "@/lib/porzadki/exclusions";

// „Ukryj wątek w historii klienta” / „pokaż” (wniosek 7) — ADMIN/STAFF.
// Nic nie usuwa: wątek znika z historii i z „ostatniego kontaktu”.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.hidden !== "boolean") return NextResponse.json({ message: "Podaj hidden (true / false)." }, { status: 400 });
  const count = await setThreadHidden(id, body.hidden, session.user.id);
  if (!count) return NextResponse.json({ message: "Nie znaleziono wiadomości." }, { status: 404 });
  const m = await prisma.emailMessage.findUnique({ where: { id }, select: { clientId: true } });
  return NextResponse.json({ count, detail: m?.clientId ? await loadClientDetail(m.clientId) : null });
}
