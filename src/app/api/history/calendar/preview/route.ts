import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { previewCalendarHistory } from "@/lib/history/calendar-import";
import { logError, logInfo } from "@/lib/logger";

// Podgląd importu historii z kalendarzy urządzeń (prompt 3A) — NIC nie
// zapisuje. Tylko ADMIN.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  try {
    const preview = await previewCalendarHistory();
    logInfo("history_calendar_preview", { userId: session.user.id, total: preview.total, toImport: preview.toImport });
    return NextResponse.json(preview);
  } catch (err) {
    logError("history_calendar_preview_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
