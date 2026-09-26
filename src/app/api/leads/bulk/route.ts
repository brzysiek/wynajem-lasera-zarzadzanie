import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { normalizePolishPhone } from "@/lib/reminders";
import { parseLeadPatch } from "@/lib/leads/validate";
import { LeadError, updateLead } from "@/lib/leads/actions";
import { logError, logInfo } from "@/lib/logger";

// Zbiorcza zmiana (np. zamknięcie zaległych sygnałów z HubSpota jako
// przegrane „brak kontaktu”). Ta sama walidacja i ślad na osi czasu co
// pojedyncza zmiana. ADMIN/STAFF.
export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string").slice(0, 300) : [];
  if (ids.length === 0) return NextResponse.json({ message: "Nie wybrano sygnałów." }, { status: 400 });
  const parsed = parseLeadPatch(body?.patch ?? {}, { normalizePhone: normalizePolishPhone });
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  let done = 0;
  try {
    for (const id of ids) {
      await updateLead(id, parsed.data, session.user.id);
      done++;
    }
    logInfo("leads_bulk_updated", { userId: session.user.id, count: done, fields: Object.keys(parsed.data) });
    return NextResponse.json({ updated: done });
  } catch (err) {
    if (err instanceof LeadError) return NextResponse.json({ message: err.message, updated: done }, { status: err.status });
    logError("leads_bulk_failed", err, { userId: session.user.id, done });
    return NextResponse.json({ message: "Nie udało się zapisać wszystkich zmian.", updated: done }, { status: 500 });
  }
}
