import { NextRequest, NextResponse } from "next/server";
import { syncAllDevices } from "@/lib/device-sync";
import { logWarn, logError, logInfo } from "@/lib/logger";

// Internal-only endpoint, meant to be hit by a real cPanel Cron Job on a
// fixed schedule (every 5 minutes) — mirrors the pattern used by
// /api/cron/reminders. This host's Node process isn't guaranteed to stay
// alive between requests, so an in-process scheduler isn't reliable. Never
// exposed/linked from the UI; a mismatched or missing secret is treated as
// an outside caller.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    logWarn("device_sync_cron_rejected", { hasSecret: Boolean(secret) });
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  try {
    const results = await syncAllDevices();
    const totalEvents = results.reduce((sum, r) => sum + r.count, 0);
    const errors = results.filter((r) => r.status === "ERROR");

    logInfo("device_sync_cron_ok", { deviceCount: results.length, errorCount: errors.length, totalEvents });

    return NextResponse.json({ deviceCount: results.length, totalEvents, errorCount: errors.length, results });
  } catch (err) {
    logError("device_sync_cron_failed", err);
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
