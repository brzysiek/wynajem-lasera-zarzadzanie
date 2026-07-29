import { NextRequest, NextResponse } from "next/server";
import { runHourlyReminderCycle } from "@/lib/reminders";
import { logWarn, logError } from "@/lib/logger";

// Internal-only endpoint, hit by a real cPanel Cron Job on a fixed schedule
// (currently every 5 minutes) on the public domain — this host's Node
// process isn't guaranteed to stay alive between requests, so an in-process
// scheduler wasn't reliable. Never exposed/linked from the UI; a mismatched
// or missing secret is treated as an outside caller.
//
// This is the "hourly" half of the two-stage reminder pipeline: it sends
// any overdue reservation confirmations (legacy — confirmations are now
// sent manually) and promotes SCHEDULED 1/3/7-day reminders into QUEUED
// once they're within the lookahead window. The actual queued sends happen
// on a separate daily schedule — see /api/cron/reminders/send.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    logWarn("reminder_cron_rejected", { hasSecret: Boolean(secret) });
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  try {
    const result = await runHourlyReminderCycle("CRON");
    return NextResponse.json(result);
  } catch (err) {
    logError("reminder_cron_failed", err);
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
