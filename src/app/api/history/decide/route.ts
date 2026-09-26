import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges, type ChangeEntry } from "@/lib/changelog/record";
import { applyDecision, parseDecideBody } from "@/lib/history/decide";
import { logError, logInfo } from "@/lib/logger";

// Decyzja biura dla grup wydarzeń na /klienci/dopasowania: przypisz do
// klienta (tworzy alias), pomiń, cofnij. ADMIN/STAFF/AGENT; KIEROWCA — 403.
// Każda grupa → wpis w dzienniku zmian (przed: klient i stan dopasowania).
export async function POST(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const parsed = parseDecideBody(await req.json().catch(() => null));
  if (typeof parsed === "string") return NextResponse.json({ message: parsed }, { status: 400 });

  try {
    const beforeRows = await prisma.rentalHistory.findMany({
      where: { titleKey: { in: parsed.keys } },
      select: { titleKey: true, clientId: true, matchState: true },
      distinct: ["titleKey"],
    });
    const result = await applyDecision(parsed, session.user.id);
    const afterRows = await prisma.rentalHistory.findMany({
      where: { titleKey: { in: parsed.keys } },
      select: { titleKey: true, clientId: true, matchState: true },
      distinct: ["titleKey"],
    });
    const afterByKey = new Map(afterRows.map((r) => [r.titleKey, r]));
    const operation = parsed.action === "assign" ? "MATCH_ASSIGN" : parsed.action === "ignore" ? "MATCH_IGNORE" : "MATCH_RESET";
    const entries: ChangeEntry[] = beforeRows.map((r) => {
      const a = afterByKey.get(r.titleKey);
      return {
        entity: "HISTORY",
        entityId: r.titleKey.slice(0, 191),
        clientId: a?.clientId ?? r.clientId,
        operation,
        field: "clientId",
        before: toLogValue({ clientId: r.clientId, matchState: r.matchState }),
        after: toLogValue({ clientId: a?.clientId ?? null, matchState: a?.matchState ?? null }),
      };
    });
    await recordChanges(prisma, { userId: session.user.id }, entries);
    logInfo("history_decision", { userId: session.user.id, action: parsed.action, groups: parsed.keys.length, events: result.events });
    return NextResponse.json(result);
  } catch (err) {
    logError("history_decision_failed", err, { userId: session.user.id, action: parsed.action });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
