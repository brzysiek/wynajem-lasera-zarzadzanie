import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { runDailySendCycle } from "@/lib/reminders";
import { logError } from "@/lib/logger";

// Manual "Wyślij teraz" trigger for admins on the Przypomnienia SMS page —
// runs just the send step (the hourly-between-9-17 cron's job) on whatever
// is already queued and due, without waiting for the next tick.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  try {
    const result = await runDailySendCycle("MANUAL");
    return NextResponse.json(result);
  } catch (err) {
    logError("reminder_run_send_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
