import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, readJson, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { parseManualEntry } from "@/lib/agent-api/manual-entry";
import { listChangeLog } from "@/lib/changelog/load";
import { changeLogFilters } from "@/lib/porzadki/http";

// API agenta: dziennik — odczyt (?klient=&paczka=&autor=&obiekt=&od=&do=&q=&limit=)
// i ręczny wpis dla zmian spoza standardowych endpointów (wymagane: obiekt,
// obiekt_id, operacja, przed, zrodlo, pewnosc).
export async function GET(req: NextRequest) {
  return withAgent(req, async () => {
    const limit = Number(req.nextUrl.searchParams.get("limit")) || 300;
    return json({ entries: await listChangeLog(changeLogFilters(req.nextUrl.searchParams), limit) });
  });
}

export async function POST(req: NextRequest) {
  return withAgent(req, async (agent) => {
    const parsed = parseManualEntry(await readJson(req));
    if (!parsed.ok) throw new AgentApiError(parsed.message);
    const e = parsed.value;
    const client = e.clientId ? await prisma.client.findUnique({ where: { id: e.clientId }, select: { id: true, name: true } }) : null;
    if (e.clientId && !client) throw new AgentApiError("Klient nie istnieje.", 404);
    const row = await prisma.changeLog.create({
      data: {
        userId: agent.userId,
        clientId: client?.id ?? null,
        clientName: client?.name ?? null,
        entity: e.entity,
        entityId: e.entityId,
        operation: e.operation,
        field: e.field,
        before: e.before,
        after: e.after,
        source: e.provenance.source,
        confidence: e.provenance.confidence,
        batch: e.provenance.batch,
      },
    });
    return json({ id: row.id }, 201);
  });
}
