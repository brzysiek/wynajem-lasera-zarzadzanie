import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fromLogValue, toLogValue } from "@/lib/changelog/diff";
import { checkUndo, isUndoable, undoKind } from "@/lib/changelog/undo-rules";
import { CLIENT_CACHE_KEYS, CONTACT_CACHE_KEYS, refreshFutureRentalCaches } from "@/lib/clients/refresh";

// Dziennik zmian — lista z filtrami i „Cofnij” (tylko ADMIN, sprawdzane w
// trasie). Cofnięcie przywraca „wartość przed”, jeśli bieżąca wartość nadal
// równa się „wartości po”; tworzy nowy wpis UNDO i oznacza oryginał.

export type ChangeLogRow = {
  id: string;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  clientId: string | null;
  clientName: string | null;
  entity: string;
  entityId: string;
  operation: string;
  field: string | null;
  before: string | null;
  after: string | null;
  source: string | null;
  confidence: string | null;
  batch: string | null;
  undoneById: string | null;
  undoOfId: string | null;
  undoable: boolean;
};

export type ChangeLogFilters = {
  clientId?: string | null;
  batch?: string | null;
  userId?: string | null;
  entity?: string | null;
  from?: Date | null;
  to?: Date | null; // włącznie (koniec dnia liczy wywołujący)
  q?: string | null;
};

function whereFor(f: ChangeLogFilters): Prisma.ChangeLogWhereInput {
  return {
    ...(f.clientId ? { clientId: f.clientId } : {}),
    ...(f.batch ? { batch: f.batch } : {}),
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.entity ? { entity: f.entity } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.q ? { OR: [{ clientName: { contains: f.q } }, { source: { contains: f.q } }, { after: { contains: f.q } }, { before: { contains: f.q } }] } : {}),
  };
}

export async function listChangeLog(f: ChangeLogFilters, limit = 300): Promise<ChangeLogRow[]> {
  const rows = await prisma.changeLog.findMany({
    where: whereFor(f),
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 5000),
    include: { user: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    userId: r.userId,
    userName: r.user?.name ?? null,
    clientId: r.clientId,
    clientName: r.clientName,
    entity: r.entity,
    entityId: r.entityId,
    operation: r.operation,
    field: r.field,
    before: r.before,
    after: r.after,
    source: r.source,
    confidence: r.confidence,
    batch: r.batch,
    undoneById: r.undoneById,
    undoOfId: r.undoOfId,
    undoable: isUndoable(r),
  }));
}

export class UndoError extends Error {
  constructor(
    message: string,
    public status: number,
    public conflict?: { expected: string | null; current: string },
  ) {
    super(message);
  }
}

type Entry = Prisma.ChangeLogGetPayload<object>;

async function currentValue(e: Entry): Promise<string> {
  switch (undoKind(e)) {
    case "client-field": {
      const c = await prisma.client.findUnique({ where: { id: e.entityId } });
      if (!c) throw new UndoError("Klient już nie istnieje.", 404);
      return toLogValue((c as unknown as Record<string, unknown>)[e.field!]);
    }
    case "contact-field": {
      const c = await prisma.clientContact.findUnique({ where: { id: e.entityId } });
      if (!c) throw new UndoError("Osoba kontaktowa już nie istnieje.", 404);
      return toLogValue((c as unknown as Record<string, unknown>)[e.field!]);
    }
    case "note-body": {
      const a = await prisma.leadActivity.findUnique({ where: { id: e.entityId }, select: { body: true } });
      if (!a) throw new UndoError("Notatka już nie istnieje.", 404);
      return toLogValue(a.body);
    }
    case "qualification": {
      const c = await prisma.client.findUnique({ where: { id: e.entityId }, select: { qualifiedAt: true, qualifiedReason: true } });
      if (!c) throw new UndoError("Klient już nie istnieje.", 404);
      return toLogValue(c);
    }
    case "invoice-rental": {
      const i = await prisma.clientInvoice.findUnique({ where: { id: e.entityId }, select: { rentalId: true } });
      if (!i) throw new UndoError("Faktura już nie istnieje.", 404);
      return toLogValue(i.rentalId);
    }
    default:
      return "null";
  }
}

async function applyBefore(tx: Prisma.TransactionClient, e: Entry): Promise<void> {
  const value = fromLogValue(e.before);
  switch (undoKind(e)) {
    case "client-field": {
      const field = e.field!;
      const data: Record<string, unknown> = {
        [field]: field === "deviceInterests" ? (Array.isArray(value) && value.length ? value : Prisma.DbNull) : value,
      };
      await tx.client.update({ where: { id: e.entityId }, data });
      return;
    }
    case "contact-field":
      await tx.clientContact.update({ where: { id: e.entityId }, data: { [e.field!]: value } });
      return;
    case "note-body":
      await tx.leadActivity.update({ where: { id: e.entityId }, data: { body: (value as string | null) ?? null, editedAt: new Date() } });
      return;
    case "qualification": {
      const v = (value ?? {}) as { qualifiedAt?: string | null; qualifiedReason?: string | null };
      await tx.client.update({
        where: { id: e.entityId },
        data: { qualifiedAt: v.qualifiedAt ? new Date(v.qualifiedAt) : null, qualifiedReason: v.qualifiedReason ?? null },
      });
      return;
    }
    case "invoice-rental":
      await tx.clientInvoice.update({ where: { id: e.entityId }, data: { rentalId: (value as string | null) ?? null } });
      return;
  }
}

export async function undoChange(id: string, userId: string): Promise<{ undoId: string }> {
  const e = await prisma.changeLog.findUnique({ where: { id } });
  if (!e) throw new UndoError("Wpis nie istnieje.", 404);
  const current = await currentValue(e);
  const check = checkUndo(e, current);
  if (!check.ok) throw new UndoError(check.message, check.reason === "conflict" ? 409 : 400, check.reason === "conflict" ? { expected: e.after, current } : undefined);

  const undoId = await prisma.$transaction(async (tx) => {
    await applyBefore(tx, e);
    const undo = await tx.changeLog.create({
      data: {
        userId,
        clientId: e.clientId,
        clientName: e.clientName,
        entity: e.entity,
        entityId: e.entityId,
        operation: "UNDO",
        field: e.field,
        before: current,
        after: e.before,
        undoOfId: e.id,
      },
    });
    await tx.changeLog.update({ where: { id: e.id }, data: { undoneById: undo.id } });
    return undo.id;
  });

  // Przyszłe wynajmy trzymają kopię danych klienta/osoby — odświeżamy jak przy zwykłej edycji.
  const kind = undoKind(e);
  if (kind === "client-field" && e.clientId && (CLIENT_CACHE_KEYS as readonly string[]).includes(e.field!)) {
    await refreshFutureRentalCaches({ clientId: e.clientId, clientFields: true });
  }
  if (kind === "contact-field" && e.clientId && (CONTACT_CACHE_KEYS as readonly string[]).includes(e.field!)) {
    await refreshFutureRentalCaches({ clientId: e.clientId, contactId: e.entityId });
  }
  return { undoId };
}
