import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { runHourlyReminderCycle } from "@/lib/reminders";
import { logError } from "@/lib/logger";

// Manual "Sprawdź teraz" trigger for admins on the Przypomnienia SMS page —
// runs just the queue-build step (the hourly cron's job), without waiting
// for the next 5-minute tick.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  try {
    const result = await runHourlyReminderCycle("MANUAL");
    return NextResponse.json(result);
  } catch (err) {
    logError("reminder_run_check_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
