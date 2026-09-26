import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { syncDeals } from "@/lib/leads/hubspot-sync";
import { logError, logInfo } from "@/lib/logger";

// „Pobierz teraz” na /sygnaly — to samo co cron, na żądanie. ADMIN/STAFF.
export async function POST() {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  try {
    const result = await syncDeals({ maxNew: 25 });
    logInfo("leads_pull_manual", { userId: session.user.id, ...result });
    return NextResponse.json(result);
  } catch (err) {
    logError("leads_pull_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
