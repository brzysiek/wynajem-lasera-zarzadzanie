import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { applyDecision, parseDecideBody } from "@/lib/history/decide";
import { logError, logInfo } from "@/lib/logger";

// Decyzja biura dla grup wydarzeń na /klienci/dopasowania: przypisz do
// klienta (tworzy alias), pomiń, cofnij. ADMIN/STAFF; KIEROWCA — 403.
export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const parsed = parseDecideBody(await req.json().catch(() => null));
  if (typeof parsed === "string") return NextResponse.json({ message: parsed }, { status: 400 });

  try {
    const result = await applyDecision(parsed, session.user.id);
    logInfo("history_decision", { userId: session.user.id, action: parsed.action, groups: parsed.keys.length, events: result.events });
    return NextResponse.json(result);
  } catch (err) {
    logError("history_decision_failed", err, { userId: session.user.id, action: parsed.action });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
