import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { rematchHistory } from "@/lib/history/calendar-import";
import { logError, logInfo } from "@/lib/logger";

// Ponowne dopasowanie automatyczne historii (np. po dodaniu klientów).
// Decyzje biura zostają nietknięte. ADMIN/STAFF.
export async function POST() {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  try {
    const changed = await rematchHistory();
    logInfo("history_rematch", { userId: session.user.id, changed });
    return NextResponse.json({ changed });
  } catch (err) {
    logError("history_rematch_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
