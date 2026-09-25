import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { applyInvoiceDecision, parseInvoiceDecision } from "@/lib/history/invoice-import";
import { logError, logInfo } from "@/lib/logger";

// Decyzja biura dla faktur bez dopasowania: przypisz (uczy alias, może
// zaproponować wpisanie NIP), pomiń, cofnij. ADMIN/STAFF; KIEROWCA — 403.
export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const parsed = parseInvoiceDecision(await req.json().catch(() => null));
  if (typeof parsed === "string") return NextResponse.json({ message: parsed }, { status: 400 });

  try {
    const result = await applyInvoiceDecision(parsed, session.user.id);
    logInfo("history_invoice_decision", { userId: session.user.id, action: parsed.action, invoices: result.invoices });
    return NextResponse.json(result);
  } catch (err) {
    logError("history_invoice_decision_failed", err, { userId: session.user.id, action: parsed.action });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
