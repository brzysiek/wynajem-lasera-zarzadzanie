import { prisma } from "@/lib/prisma";
import { applyDecision, type DecideAction } from "@/lib/history/decide";
import { applyInvoiceDecision, type InvoiceDecision } from "@/lib/history/invoice-import";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges, type ChangeEntry } from "@/lib/changelog/record";

// Decyzje w dopasowaniach (grupy z kalendarzy, faktury) z wpisem w dzienniku
// — wspólne dla panelu (/api/history/…/decide), API agenta i MCP.

const OPERATION = { assign: "MATCH_ASSIGN", ignore: "MATCH_IGNORE", reset: "MATCH_RESET" } as const;

export async function decideHistoryLogged(d: DecideAction, userId: string, opts: { approvedById?: string | null } = {}) {
  const select = { titleKey: true, clientId: true, matchState: true } as const;
  const beforeRows = await prisma.rentalHistory.findMany({ where: { titleKey: { in: d.keys } }, select, distinct: ["titleKey"] });
  const result = await applyDecision(d, userId);
  const afterRows = await prisma.rentalHistory.findMany({ where: { titleKey: { in: d.keys } }, select, distinct: ["titleKey"] });
  const afterByKey = new Map(afterRows.map((r) => [r.titleKey, r]));
  const entries: ChangeEntry[] = beforeRows.map((r) => {
    const a = afterByKey.get(r.titleKey);
    return {
      entity: "HISTORY",
      entityId: r.titleKey.slice(0, 191),
      clientId: a?.clientId ?? r.clientId,
      operation: OPERATION[d.action],
      field: "clientId",
      before: toLogValue({ clientId: r.clientId, matchState: r.matchState }),
      after: toLogValue({ clientId: a?.clientId ?? null, matchState: a?.matchState ?? null }),
    };
  });
  await recordChanges(prisma, { userId, approvedById: opts.approvedById }, entries);
  return result;
}

export async function decideInvoicesLogged(d: InvoiceDecision, userId: string, opts: { approvedById?: string | null } = {}) {
  const select = { id: true, clientId: true, matchState: true } as const;
  const beforeRows = await prisma.clientInvoice.findMany({ where: { id: { in: d.ids } }, select });
  const result = await applyInvoiceDecision(d, userId);
  const afterRows = await prisma.clientInvoice.findMany({ where: { id: { in: d.ids } }, select });
  const afterById = new Map(afterRows.map((r) => [r.id, r]));
  await recordChanges(
    prisma,
    { userId, approvedById: opts.approvedById },
    beforeRows.map((r) => {
      const a = afterById.get(r.id);
      return {
        entity: "INVOICE" as const,
        entityId: r.id,
        clientId: a?.clientId ?? r.clientId,
        operation: OPERATION[d.action],
        field: "clientId",
        before: toLogValue({ clientId: r.clientId, matchState: r.matchState }),
        after: toLogValue({ clientId: a?.clientId ?? null, matchState: a?.matchState ?? null }),
      };
    }),
  );
  return result;
}
