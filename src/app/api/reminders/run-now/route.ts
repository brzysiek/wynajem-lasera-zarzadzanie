import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { sendDueReminders } from "@/lib/reminders";
import { logError } from "@/lib/logger";

// Manual "sprawdź teraz" trigger for admins on the Bramka page — runs the
// same due-reminders check the background scheduler runs periodically,
// without waiting for the next interval tick.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  try {
    const result = await sendDueReminders("MANUAL");
    return NextResponse.json(result);
  } catch (err) {
    logError("reminder_run_now_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
