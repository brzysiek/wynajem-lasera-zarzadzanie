import { NextRequest, NextResponse } from "next/server";
import { sendDueReminders } from "@/lib/reminders";
import { logWarn, logError } from "@/lib/logger";

// Internal-only endpoint. This host (cPanel/LiteSpeed lsnode) has no real
// cron — server.js runs a setInterval loop that calls this route on its own
// loopback address with a per-process secret, since that's the only
// persistent, always-on piece of the deployment. Never exposed/linked from
// the UI; a mismatched or missing secret is treated as an outside caller.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    logWarn("reminder_cron_rejected", { hasSecret: Boolean(secret) });
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  try {
    const result = await sendDueReminders();
    return NextResponse.json(result);
  } catch (err) {
    logError("reminder_cron_failed", err);
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
