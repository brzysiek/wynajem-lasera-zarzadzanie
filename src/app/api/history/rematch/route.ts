import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { rematchHistory } from "@/lib/history/calendar-import";
import { countAssignedHistory } from "@/lib/history/decide";
import { rematchInvoices } from "@/lib/history/invoice-import";
import { logError, logInfo } from "@/lib/logger";

// Ponowne dopasowanie automatyczne historii (kalendarze i faktury) (np. po dodaniu klientów).
// Decyzje biura zostają nietknięte. ADMIN/STAFF/AGENT.
export async function POST() {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  try {
    const before = await countAssignedHistory();
    const changed = (await rematchHistory()) + (await rematchInvoices());
    const newlyAssigned = Math.max(0, (await countAssignedHistory()) - before);
    logInfo("history_rematch", { userId: session.user.id, changed, newlyAssigned });
    return NextResponse.json({ changed, newlyAssigned });
  } catch (err) {
    logError("history_rematch_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
