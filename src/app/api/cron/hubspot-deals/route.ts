import { NextRequest, NextResponse } from "next/server";
import { syncDeals } from "@/lib/leads/hubspot-sync";
import { logWarn, logError, logInfo } from "@/lib/logger";

// Pobieranie nowych sygnałów z HubSpota co 5 minut (prompt 2, 2.4) — ten sam
// wzorzec co /api/cron/sync-devices: cPanel Cron Job z nagłówkiem
// x-cron-secret. Tylko odczyt z HubSpota.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    logWarn("hubspot_deals_cron_rejected", { hasSecret: Boolean(secret) });
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return NextResponse.json({ skipped: "Brak tokenu HubSpot." });
  try {
    const result = await syncDeals({ maxNew: 40 });
    if (result.created || result.notesAdded) logInfo("hubspot_deals_cron_ok", result);
    return NextResponse.json(result);
  } catch (err) {
    logError("hubspot_deals_cron_failed", err);
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
