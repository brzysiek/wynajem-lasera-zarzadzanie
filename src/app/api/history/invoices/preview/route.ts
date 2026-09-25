import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { previewInvoiceHistory } from "@/lib/history/invoice-import";
import { logError, logInfo } from "@/lib/logger";

// Podgląd importu faktur z Fakturowni do historii klientów (prompt 3B) —
// NIC nie zapisuje. Tylko ADMIN.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  try {
    const preview = await previewInvoiceHistory();
    logInfo("history_invoices_preview", { userId: session.user.id, total: preview.total, toImport: preview.toImport });
    return NextResponse.json(preview);
  } catch (err) {
    logError("history_invoices_preview_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
