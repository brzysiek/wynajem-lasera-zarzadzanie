import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { decideProposals } from "@/lib/porzadki/change-proposals";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";
import { logInfo } from "@/lib/logger";

// Akceptacja / odrzucenie propozycji (pojedynczo i hurtem) — tylko ADMIN.
// Body: { ids, action: "accept" | "reject", comment?, force? }. Akceptacja
// wykonuje zmianę od razu; propozycje, których wartość zmieniła się od
// zgłoszenia, bez force wracają jako konflikty.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string") : [];
  const action = body?.action === "accept" || body?.action === "reject" ? body.action : null;
  if (!ids.length || !action) return NextResponse.json({ message: "Podaj ids i action (accept | reject)." }, { status: 400 });
  try {
    const r = await decideProposals(ids, action, { userId: session.user.id, role: session.user.role }, { comment: typeof body.comment === "string" ? body.comment : null, force: body.force === true });
    logInfo("change_proposals_decided", { userId: session.user.id, action, ...{ accepted: r.accepted, rejected: r.rejected, conflicts: r.conflicts.length, failed: r.failed.length } });
    return NextResponse.json(r);
  } catch (err) {
    return porzadkiErrorResponse(err, "change_proposals_decide_failed", session.user.id);
  }
}
