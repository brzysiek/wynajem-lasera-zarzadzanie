import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { normalizePolishPhone } from "@/lib/reminders";
import { loadLeadDetail } from "@/lib/leads/load";
import { LeadError, sendLeadSms } from "@/lib/leads/actions";
import { logError, logInfo } from "@/lib/logger";

// SMS z karty sygnału. ADMIN/STAFF; KIEROWCA — 403.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const phone = typeof body?.phone === "string" ? normalizePolishPhone(body.phone) : null;
  if (!message) return NextResponse.json({ message: "Treść wiadomości nie może być pusta." }, { status: 400 });
  if (!phone) return NextResponse.json({ message: "Podaj poprawny polski numer telefonu." }, { status: 400 });
  try {
    await sendLeadSms(id, phone, message, session.user.id);
    logInfo("lead_sms_sent", { userId: session.user.id, leadId: id });
    return NextResponse.json(await loadLeadDetail(id));
  } catch (err) {
    if (err instanceof LeadError) return NextResponse.json({ message: err.message }, { status: err.status });
    logError("lead_sms_failed", err, { userId: session.user.id, leadId: id });
    return NextResponse.json({ message: "Nie udało się wysłać SMS-a." }, { status: 500 });
  }
}
