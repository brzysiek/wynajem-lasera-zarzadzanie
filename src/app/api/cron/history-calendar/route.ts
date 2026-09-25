import { NextRequest, NextResponse } from "next/server";
import { importCalendarHistory } from "@/lib/history/calendar-import";
import { logWarn, logError, logInfo } from "@/lib/logger";

// Codzienny cron (prompt 3, 2.1): dopisuje do historii wydarzenia, które
// wypadły z 30-dniowego okna synchronizacji, a nie ma ich w rentals (np.
// wpisane w kalendarzu wstecz). Ten sam wzorzec co /api/cron/sync-devices:
// wywoływany przez cPanel Cron Job z nagłówkiem x-cron-secret.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    logWarn("history_calendar_cron_rejected", { hasSecret: Boolean(secret) });
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  try {
    const result = await importCalendarHistory();
    logInfo("history_calendar_cron_ok", { created: result.created, rematched: result.rematched, errors: result.errors.length });
    return NextResponse.json(result);
  } catch (err) {
    logError("history_calendar_cron_failed", err);
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
