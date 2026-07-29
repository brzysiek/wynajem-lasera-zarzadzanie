import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { runHourlyReminderCycle, runDailySendCycle } from "@/lib/reminders";
import { logError } from "@/lib/logger";

// Manual "Wyślij teraz" trigger for admins on the Wysyłka SMS page — runs
// the full pipeline in one go (build the queue, then send whatever in it is
// due), rather than waiting for the next hourly/daily cron tick. Useful for
// testing and for forcing an immediate send without touching cPanel.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  try {
    const hourly = await runHourlyReminderCycle("MANUAL");
    const daily = await runDailySendCycle("MANUAL");
    return NextResponse.json({
      checked: hourly.checked + daily.checked,
      sent: hourly.sent + daily.sent,
      failed: hourly.failed + daily.failed,
      queued: hourly.queued,
    });
  } catch (err) {
    logError("reminder_run_now_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
