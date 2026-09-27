import { prisma } from "@/lib/prisma";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges, type ChangeActor } from "@/lib/changelog/record";
import { parseOpportunityInput } from "@/lib/clients/opportunity-rules";

// Szanse sprzedaży klienta: dodanie (panel, agent przez MCP szansa_dodaj)
// i zmiana etapu / zamknięcie (panel). Wpis w dzienniku zmian.

export type OpportunityResult = { ok: true; id: string } | { ok: false; status: number; message: string };

export async function addOpportunity(clientId: string, body: Record<string, unknown>, actor: ChangeActor & { source?: string | null }): Promise<OpportunityResult> {
  const parsed = parseOpportunityInput(body);
  if (!parsed.ok) return { ok: false, status: 400, message: parsed.message };
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) return { ok: false, status: 404, message: "Nie znaleziono klienta." };
  const v = parsed.value;
  const id = await prisma.$transaction(async (tx) => {
    const o = await tx.clientOpportunity.create({
      data: {
        clientId,
        device: v.device!,
        stage: v.stage ?? "rozmowa",
        chance: v.chance ?? null,
        lastContact: v.lastContact ?? null,
        returnAt: v.returnAt ?? null,
        note: v.note ?? null,
        source: actor.source ?? actor.provenance?.source ?? null,
        createdById: actor.userId,
        closedAt: v.stage === "wygrana" || v.stage === "przegrana" ? new Date() : null,
      },
    });
    await recordChanges(tx, actor, [{ entity: "CLIENT", entityId: clientId, clientId, operation: "CREATE", field: "szansa", before: "null", after: toLogValue({ szansa: v.device, etap: o.stage, szansa_ocena: o.chance, wrocic: o.returnAt, opis: o.note }) }]);
    return o.id;
  });
  return { ok: true, id };
}

export async function updateOpportunity(clientId: string, id: string, body: Record<string, unknown>, actor: ChangeActor): Promise<OpportunityResult> {
  const parsed = parseOpportunityInput(body, { partial: true });
  if (!parsed.ok) return { ok: false, status: 400, message: parsed.message };
  const current = await prisma.clientOpportunity.findFirst({ where: { id, clientId } });
  if (!current) return { ok: false, status: 404, message: "Nie znaleziono szansy." };
  const v = parsed.value;
  const closing = v.stage === "wygrana" || v.stage === "przegrana";
  await prisma.$transaction(async (tx) => {
    await tx.clientOpportunity.update({ where: { id }, data: { ...v, ...(v.stage ? { closedAt: closing ? (current.closedAt ?? new Date()) : null } : {}) } });
    await recordChanges(tx, actor, [
      { entity: "CLIENT", entityId: clientId, clientId, operation: "FIELD_CHANGE", field: "szansa", before: toLogValue({ szansa: current.device, etap: current.stage }), after: toLogValue({ szansa: v.device ?? current.device, etap: v.stage ?? current.stage }) },
    ]);
  });
  return { ok: true, id };
}
