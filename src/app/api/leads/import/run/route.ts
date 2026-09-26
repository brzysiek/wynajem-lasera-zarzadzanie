import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { syncDeals } from "@/lib/leads/hubspot-sync";
import { logError, logInfo } from "@/lib/logger";

// Import transakcji partiami (UI woła w pętli, aż remaining = 0).
// Idempotentny po hubspotDealId. HubSpot tylko czytany. Tylko ADMIN.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  try {
    // Ostatnia partia przelicza też sygnały dociągnięte wcześniej przez crona
    // (lista „Do obdzwonienia”, archiwum, kwalifikacja — prompt 2 v2).
    const result = await syncDeals({ maxNew: 25, reclassify: true });
    logInfo("leads_import_batch", { userId: session.user.id, ...result });
    return NextResponse.json(result);
  } catch (err) {
    logError("leads_import_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
