import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { actOnProposal } from "@/lib/marketing/analysis";
import type { Action } from "@/lib/marketing/analysis-rules";
import { logError } from "@/lib/logger";

// Wniosek 54, etap 1c (zakładka Analiza): decyzja administratora w sprawie
// propozycji — accept / reject (z opcjonalnym komentarzem) / undo (do wdrożenia) /
// implement (z notatką). Tylko ADMIN; każda zmiana trafia do dziennika.
const ACTIONS: Action[] = ["accept", "reject", "undo", "implement"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: unknown; comment?: unknown; note?: unknown } | null;
  const action = ACTIONS.find((a) => a === body?.action);
  if (!action) return NextResponse.json({ message: `action: ${ACTIONS.join(" | ")}.` }, { status: 400 });
  try {
    const res = await actOnProposal(id, action, { userId: session.user.id, name: session.user.name ?? "Administrator" }, { comment: typeof body?.comment === "string" ? body.comment : null, note: typeof body?.note === "string" ? body.note : null });
    if (!res.ok) return NextResponse.json({ message: res.message }, { status: res.status });
    return NextResponse.json({ ok: true, proposal: res.proposal });
  } catch (err) {
    logError("marketing_proposal_action_failed", err, { id, action, userId: session.user.id });
    return NextResponse.json({ message: "Nie udało się zapisać decyzji." }, { status: 500 });
  }
}
