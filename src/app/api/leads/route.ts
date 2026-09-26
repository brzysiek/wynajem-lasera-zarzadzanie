import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { normalizePolishPhone } from "@/lib/reminders";
import { parseNewLead } from "@/lib/leads/validate";
import { createLead, LeadError } from "@/lib/leads/actions";
import { logError, logInfo } from "@/lib/logger";

// Nowy sygnał z panelu (np. telefon od klientki). ADMIN/STAFF; KIEROWCA — 403.
export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const parsed = parseNewLead(body, { normalizePhone: normalizePolishPhone });
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  try {
    const id = await createLead(parsed.data, session.user.id);
    logInfo("lead_created", { userId: session.user.id, leadId: id });
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof LeadError) return NextResponse.json({ message: err.message }, { status: err.status });
    logError("lead_create_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: "Nie udało się dodać sygnału." }, { status: 500 });
  }
}
