import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges } from "@/lib/changelog/record";
import { applyInvoiceDecision, parseInvoiceDecision } from "@/lib/history/invoice-import";
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
    const beforeRows = await prisma.clientInvoice.findMany({ where: { id: { in: parsed.ids } }, select: { id: true, clientId: true, matchState: true } });
    const result = await applyInvoiceDecision(parsed, session.user.id);
    const afterRows = await prisma.clientInvoice.findMany({ where: { id: { in: parsed.ids } }, select: { id: true, clientId: true, matchState: true } });
    const afterById = new Map(afterRows.map((r) => [r.id, r]));
    const operation = parsed.action === "assign" ? "MATCH_ASSIGN" : parsed.action === "ignore" ? "MATCH_IGNORE" : "MATCH_RESET";
    await recordChanges(
      prisma,
      { userId: session.user.id },
      beforeRows.map((r) => {
        const a = afterById.get(r.id);
        return {
          entity: "INVOICE" as const,
          entityId: r.id,
          clientId: a?.clientId ?? r.clientId,
          operation,
          field: "clientId",
          before: toLogValue({ clientId: r.clientId, matchState: r.matchState }),
          after: toLogValue({ clientId: a?.clientId ?? null, matchState: a?.matchState ?? null }),
        };
      }),
    );
    logInfo("history_invoice_decision", { userId: session.user.id, action: parsed.action, invoices: result.invoices });
    return NextResponse.json(result);
  } catch (err) {
    logError("history_invoice_decision_failed", err, { userId: session.user.id, action: parsed.action });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
