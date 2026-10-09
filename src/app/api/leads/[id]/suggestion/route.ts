import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { SuggestionError, loadSuggestion, requestSuggestionUpdate } from "@/lib/leads/lead-suggestion";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";

// „Poproś o aktualizację” sugestii Klaudiusza (wniosek 47, część 2): oznacza
// sygnał dla następnego zaplanowanego przebiegu — bez natychmiastowego efektu.
// ADMIN/STAFF; agent zapisuje sugestie tylko narzędziem MCP.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  try {
    await requestSuggestionUpdate(id);
    const lead = await prisma.lead.findUnique({ where: { id }, select: { clientId: true } });
    return NextResponse.json({ suggestion: await loadSuggestion(id, lead?.clientId ?? null) });
  } catch (err) {
    if (err instanceof SuggestionError) return NextResponse.json({ message: err.message }, { status: err.status });
    logError("lead_suggestion_request_failed", err, { leadId: id, userId: session.user.id });
    return NextResponse.json({ message: "Nie udało się zapisać prośby." }, { status: 500 });
  }
}
