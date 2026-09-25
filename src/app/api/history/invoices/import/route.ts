import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { importInvoiceHistory } from "@/lib/history/invoice-import";
import { logError, logInfo } from "@/lib/logger";

// Import faktur z Fakturowni do client_invoices (prompt 3B). Idempotentny.
// Z Fakturowni tylko odczyt. Tylko ADMIN.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  try {
    const result = await importInvoiceHistory();
    logInfo("history_invoices_import", { userId: session.user.id, ...result });
    return NextResponse.json(result);
  } catch (err) {
    logError("history_invoices_import_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
