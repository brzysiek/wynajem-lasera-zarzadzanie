import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { normalizePolishPhone } from "@/lib/reminders";
import { loadLeadDetail } from "@/lib/leads/load";
import { parseLeadPatch } from "@/lib/leads/validate";
import { LeadError, updateLead } from "@/lib/leads/actions";
import { logError, logInfo } from "@/lib/logger";

// Karta sygnału: odczyt i zmiany (etap, przegrana, dane z formularza,
// prowadząca osoba, rezerwacja, klient). ADMIN/STAFF; KIEROWCA — 403.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const detail = await loadLeadDetail(id);
  if (!detail) return NextResponse.json({ message: "Sygnał nie istnieje." }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const parsed = parseLeadPatch(body, { normalizePhone: normalizePolishPhone });
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  try {
    await updateLead(id, parsed.data, session.user.id);
    logInfo("lead_updated", { userId: session.user.id, leadId: id, fields: Object.keys(parsed.data) });
    return NextResponse.json(await loadLeadDetail(id));
  } catch (err) {
    if (err instanceof LeadError) return NextResponse.json({ message: err.message }, { status: err.status });
    logError("lead_update_failed", err, { userId: session.user.id, leadId: id });
    return NextResponse.json({ message: "Nie udało się zapisać zmian." }, { status: 500 });
  }
}
