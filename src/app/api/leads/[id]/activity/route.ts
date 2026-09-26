import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges } from "@/lib/changelog/record";
import { loadLeadDetail } from "@/lib/leads/load";
import { LeadError, addLeadNote, logLeadActivity, type CallOutcome } from "@/lib/leads/actions";
import { parseDay } from "@/lib/leads/validate";
import { STAGE_KEYS } from "@/lib/leads/labels";
import type { LeadStageKey } from "@/lib/leads/parse-deal";
import { logError, logInfo } from "@/lib/logger";

const OUTCOMES: CallOutcome[] = ["talked", "no_answer", "callback", "note", "email"];

// Wynik rozmowy / notatka z karty sygnału. ADMIN/STAFF; AGENT — tylko
// notatka (bez przejęcia sygnału, etapu i terminu), zapisana też w dzienniku
// zmian; KIEROWCA — 403.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const outcome = body?.outcome as CallOutcome;
  if (!OUTCOMES.includes(outcome)) return NextResponse.json({ message: "Nieznany wynik." }, { status: 400 });
  if (session.user.role === "AGENT") {
    if (outcome !== "note" || (body && ("stage" in body || "nextActionAt" in body))) {
      return NextResponse.json({ message: "Agent dodaje tylko notatki." }, { status: 403 });
    }
    try {
      const text = typeof body?.body === "string" ? body.body.slice(0, 5000) : "";
      const note = await addLeadNote(id, text, session.user.id);
      await recordChanges(prisma, { userId: session.user.id }, [
        { entity: "NOTE", entityId: note.activityId, clientId: note.clientId, operation: "CREATE", before: "null", after: toLogValue(text.trim()) },
      ]);
      logInfo("lead_activity_logged", { userId: session.user.id, leadId: id, outcome });
      return NextResponse.json(await loadLeadDetail(id));
    } catch (err) {
      if (err instanceof LeadError) return NextResponse.json({ message: err.message }, { status: err.status });
      throw err;
    }
  }
  const next = body && "nextActionAt" in body ? parseDay(body.nextActionAt) : undefined;
  if (body && "nextActionAt" in body && next === undefined) return NextResponse.json({ message: "Nieprawidłowa data." }, { status: 400 });
  const stage = STAGE_KEYS.includes(body?.stage) && body.stage !== "PRZEGRANA" ? (body.stage as LeadStageKey) : undefined;
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 5000) || null : null;
  try {
    await logLeadActivity(id, { outcome, body: text, nextActionAt: next, stage }, session.user.id);
    logInfo("lead_activity_logged", { userId: session.user.id, leadId: id, outcome });
    return NextResponse.json(await loadLeadDetail(id));
  } catch (err) {
    if (err instanceof LeadError) return NextResponse.json({ message: err.message }, { status: err.status });
    logError("lead_activity_failed", err, { userId: session.user.id, leadId: id });
    return NextResponse.json({ message: "Nie udało się zapisać." }, { status: 500 });
  }
}
