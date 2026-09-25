import { NextRequest, NextResponse } from "next/server";
import { importCalendarHistory } from "@/lib/history/calendar-import";
import { importInvoiceHistory } from "@/lib/history/invoice-import";
import { getFakturowniaConfigStatus } from "@/lib/integrations/fakturownia";
import { logWarn, logError, logInfo } from "@/lib/logger";

// Codzienny cron historii klienta (prompt 3, 2.1 i 3): dopisuje wydarzenia,
// które wypadły z 30-dniowego okna synchronizacji kalendarzy (jeśli nie ma
// ich w rentals), oraz nowe faktury z Fakturowni. Ten sam wzorzec co
// /api/cron/sync-devices: cPanel Cron Job z nagłówkiem x-cron-secret.
// Obie części niezależne — błąd jednej nie blokuje drugiej.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    logWarn("history_cron_rejected", { hasSecret: Boolean(secret) });
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const out: Record<string, unknown> = {};
  let failed = false;
  try {
    const r = await importCalendarHistory();
    out.calendar = { created: r.created, rematched: r.rematched, errors: r.errors.length };
  } catch (err) {
    failed = true;
    logError("history_cron_calendar_failed", err);
    out.calendar = { error: err instanceof Error ? err.message : String(err) };
  }
  if (getFakturowniaConfigStatus().configured) {
    try {
      out.invoices = await importInvoiceHistory();
    } catch (err) {
      failed = true;
      logError("history_cron_invoices_failed", err);
      out.invoices = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (!failed) logInfo("history_cron_ok", out);
  return NextResponse.json(out, { status: failed ? 500 : 200 });
}
