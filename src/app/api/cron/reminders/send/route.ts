import { NextRequest, NextResponse } from "next/server";
import { runDailySendCycle } from "@/lib/reminders";
import { logWarn, logError } from "@/lib/logger";

// Internal-only endpoint, meant to be hit by a second cPanel Cron Job on a
// once-a-day schedule (e.g. 8:00) — that schedule lives only in cPanel, not
// in this app, by design: it's what makes the send time predictable without
// needing an app-level "reminder hour" setting. Never exposed/linked from
// the UI; a mismatched or missing secret is treated as an outside caller.
//
// This is the "daily" half of the two-stage reminder pipeline: it sends
// whatever is QUEUED and actually due today. Building the queue happens
// separately, more frequently — see /api/cron/reminders.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    logWarn("reminder_send_cron_rejected", { hasSecret: Boolean(secret) });
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  try {
    const result = await runDailySendCycle("CRON");
    return NextResponse.json(result);
  } catch (err) {
    logError("reminder_send_cron_failed", err);
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
