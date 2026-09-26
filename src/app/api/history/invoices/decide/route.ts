import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { parseInvoiceDecision } from "@/lib/history/invoice-import";
import { decideInvoicesLogged } from "@/lib/history/decide-logged";
import { logError, logInfo } from "@/lib/logger";

// Decyzja biura dla faktur bez dopasowania: przypisz (uczy alias, może
// zaproponować wpisanie NIP), pomiń, cofnij. ADMIN/STAFF/AGENT; KIEROWCA —
// 403. Każda faktura → wpis w dzienniku zmian.
export async function POST(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const parsed = parseInvoiceDecision(await req.json().catch(() => null));
  if (typeof parsed === "string") return NextResponse.json({ message: parsed }, { status: 400 });

  try {
    const result = await decideInvoicesLogged(parsed, session.user.id);
    logInfo("history_invoice_decision", { userId: session.user.id, action: parsed.action, invoices: result.invoices });
    return NextResponse.json(result);
  } catch (err) {
    logError("history_invoice_decision_failed", err, { userId: session.user.id, action: parsed.action });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
