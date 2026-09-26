import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FieldChange } from "@/lib/changelog/diff";
import type { Provenance } from "@/lib/changelog/provenance";

// Zapis do dziennika zmian (model ChangeLog). Wywoływany przez endpointy
// zapisu — w tej samej transakcji co zmiana, gdy to możliwe.

export type ChangeEntity = "CLIENT" | "CONTACT" | "LEAD" | "HISTORY" | "INVOICE" | "TASK" | "NOTE" | "TASK_COMMENT";

export type ChangeOperation =
  | "FIELD_CHANGE"
  | "CREATE"
  | "QUALIFY"
  | "UNQUALIFY"
  | "MATCH_ASSIGN"
  | "MATCH_IGNORE"
  | "MATCH_RESET"
  | "STATUS_CHANGE"
  | "UNDO";

export type ChangeEntry = {
  entity: ChangeEntity;
  entityId: string;
  operation: ChangeOperation;
  clientId?: string | null;
  field?: string | null;
  before?: string | null;
  after?: string | null;
};

export type ChangeActor = { userId: string; provenance?: Provenance | null };

type Db = Prisma.TransactionClient | typeof prisma;

export async function recordChanges(db: Db, actor: ChangeActor, entries: ChangeEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const clientIds = [...new Set(entries.map((e) => e.clientId).filter((id): id is string => !!id))];
  const clients = clientIds.length
    ? await db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const p = actor.provenance ?? null;
  await db.changeLog.createMany({
    data: entries.map((e) => ({
      userId: actor.userId,
      clientId: e.clientId && names.has(e.clientId) ? e.clientId : null,
      clientName: e.clientId ? (names.get(e.clientId) ?? null) : null,
      entity: e.entity,
      entityId: e.entityId,
      operation: e.operation,
      field: e.field ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
      source: p?.source ?? null,
      confidence: p?.confidence ?? null,
      batch: p?.batch ?? null,
    })),
  });
}

// Zmiany pól jednego rekordu → wpisy FIELD_CHANGE.
export function fieldEntries(
  entity: ChangeEntity,
  entityId: string,
  clientId: string | null,
  changes: FieldChange[],
): ChangeEntry[] {
  return changes.map((c) => ({ entity, entityId, clientId, operation: "FIELD_CHANGE", field: c.field, before: c.before, after: c.after }));
}
