import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { IntakeError, createLeadFromIntake, rejectIntake } from "@/lib/leads/mail-intake";
import { logError } from "@/lib/logger";

// Decyzja człowieka: „Sygnał” (zakłada sygnał, także „To jednak sygnał” z
// odrzuconych) albo „Nie”. ADMIN/STAFF — agent tylko podaje rekomendację (MCP).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  try {
    if (body?.action === "signal") return NextResponse.json({ ok: true, ...(await createLeadFromIntake(id, { userId: session.user.id })) });
    if (body?.action === "reject") {
      await rejectIntake(id, session.user.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ message: "Podaj action: signal albo reject." }, { status: 400 });
  } catch (err) {
    if (err instanceof IntakeError) return NextResponse.json({ message: err.message }, { status: err.status });
    logError("mail_intake_decision_failed", err, { id, userId: session.user.id });
    return NextResponse.json({ message: "Nie udało się zapisać decyzji." }, { status: 500 });
  }
}
