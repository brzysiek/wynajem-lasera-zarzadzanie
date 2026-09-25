import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { importCalendarHistory } from "@/lib/history/calendar-import";
import { logError, logInfo } from "@/lib/logger";

// Import historii z kalendarzy urządzeń do rental_history (prompt 3A).
// Idempotentny — powtórne uruchomienie dokłada tylko brakujące wydarzenia.
// Nie tworzy żadnego Rental, ReminderRule ani Message. Tylko ADMIN.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  try {
    const result = await importCalendarHistory();
    logInfo("history_calendar_import", { userId: session.user.id, created: result.created, rematched: result.rematched, errors: result.errors.length });
    return NextResponse.json(result);
  } catch (err) {
    logError("history_calendar_import_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
