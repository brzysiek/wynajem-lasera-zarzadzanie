import { NextRequest, NextResponse } from "next/server";
import { runGmailSync } from "@/lib/gmail/sync";
import { logWarn, logError } from "@/lib/logger";

// Historia e-maili co 5 minut (prompt 3, 4.3) — ten sam wzorzec co
// /api/cron/sync-devices. Nic nie robi, gdy `gmail_sync_enabled` wyłączone.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    logWarn("gmail_cron_rejected", { hasSecret: Boolean(secret) });
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }
  try {
    const results = await runGmailSync({ budgetMs: 40_000 });
    return NextResponse.json(results ? { results } : { skipped: "Synchronizacja e-maili wyłączona." });
  } catch (err) {
    logError("gmail_cron_failed", err);
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
