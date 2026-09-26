import { prisma } from "@/lib/prisma";
import type { ArchiveReasonKey } from "@/lib/porzadki/labels";
import { PorzadkiError, type Actor } from "@/lib/porzadki/proposals";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges, type ChangeEntry } from "@/lib/changelog/record";

// Archiwum (Porządki, etap 4). Archiwizuje, przywraca i trwale usuwa tylko
// ADMIN (sprawdzane w trasach). Archiwizacja klienta chowa też jego sygnały;
// przywrócenie oddaje sygnały zarchiwizowane razem z nim.
//
// Trwałe usunięcie: rekord musi być najpierw w archiwum. W dzienniku zostaje
// minimalny ślad (ID, nazwa, powód, kto, kiedy); wcześniejsze wartości
// przed/po tego klienta są czyszczone (RODO). ID HubSpota trafiają na listę
// blokad, żeby import ich nie przywrócił. W HubSpocie nic się nie zmienia.

export { parseArchiveInput, parseTypeIds, type ArchiveInput, type ArchiveType } from "@/lib/porzadki/archive-rules";
import type { ArchiveInput, ArchiveType } from "@/lib/porzadki/archive-rules";

export async function archiveRecords(type: ArchiveType, ids: string[], input: ArchiveInput, actor: Actor): Promise<number> {
  const now = new Date();
  const data = { archivedAt: now, archiveReason: input.reason, archiveNote: input.note, archivedById: actor.userId, archiveBatch: input.batch };
  const after = toLogValue({ reason: input.reason, note: input.note, batch: input.batch });
  const entries: ChangeEntry[] = [];
  let count = 0;
  await prisma.$transaction(async (tx) => {
    if (type === "client") {
      const clients = await tx.client.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } });
      const clientIds = clients.map((c) => c.id);
      if (!clientIds.length) return;
      await tx.client.updateMany({ where: { id: { in: clientIds } }, data });
      const leads = await tx.lead.findMany({ where: { clientId: { in: clientIds }, archivedAt: null }, select: { id: true, clientId: true } });
      if (leads.length) await tx.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data });
      for (const id of clientIds) entries.push({ entity: "CLIENT", entityId: id, clientId: id, operation: "ARCHIVE", before: "null", after });
      for (const l of leads) entries.push({ entity: "LEAD", entityId: l.id, clientId: l.clientId, operation: "ARCHIVE", before: "null", after });
      count = clientIds.length;
    } else {
      const leads = await tx.lead.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true, clientId: true } });
      if (!leads.length) return;
      await tx.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data });
      for (const l of leads) entries.push({ entity: "LEAD", entityId: l.id, clientId: l.clientId, operation: "ARCHIVE", before: "null", after });
      count = leads.length;
    }
    await recordChanges(tx, { userId: actor.userId, provenance: { source: input.note, confidence: null, batch: input.batch } }, entries);
  });
  return count;
}

const CLEAR = { archivedAt: null, archiveReason: null, archiveNote: null, archivedById: null, archiveBatch: null };

export async function restoreRecords(type: ArchiveType, ids: string[], actor: Actor): Promise<number> {
  const entries: ChangeEntry[] = [];
  let count = 0;
  await prisma.$transaction(async (tx) => {
    if (type === "client") {
      const clients = await tx.client.findMany({ where: { id: { in: ids }, archivedAt: { not: null } }, select: { id: true, archivedAt: true, archiveReason: true } });
      for (const c of clients) {
        await tx.client.update({ where: { id: c.id }, data: CLEAR });
        // Sygnały zarchiwizowane razem z klientem (ta sama chwila) wracają z nim.
        const leads = await tx.lead.findMany({ where: { clientId: c.id, archivedAt: c.archivedAt }, select: { id: true } });
        if (leads.length) await tx.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: CLEAR });
        entries.push({ entity: "CLIENT", entityId: c.id, clientId: c.id, operation: "RESTORE", before: toLogValue({ reason: c.archiveReason }), after: "null" });
        for (const l of leads) entries.push({ entity: "LEAD", entityId: l.id, clientId: c.id, operation: "RESTORE", before: toLogValue({ reason: c.archiveReason }), after: "null" });
      }
      count = clients.length;
    } else {
      const leads = await tx.lead.findMany({ where: { id: { in: ids }, archivedAt: { not: null } }, select: { id: true, clientId: true, archiveReason: true } });
      if (leads.length) await tx.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: CLEAR });
      for (const l of leads) entries.push({ entity: "LEAD", entityId: l.id, clientId: l.clientId, operation: "RESTORE", before: toLogValue({ reason: l.archiveReason }), after: "null" });
      count = leads.length;
    }
    await recordChanges(tx, { userId: actor.userId }, entries);
  });
  return count;
}

// --- widok /archiwum ---

export type ArchiveRow = {
  type: ArchiveType;
  id: string;
  kindLabel: "klient" | "kontakt z zapytania" | "sygnał";
  name: string;
  detail: string | null; // miasto / e-mail / klient sygnału
  reason: ArchiveReasonKey | null;
  note: string | null;
  batch: string | null;
  archivedAt: string;
  archivedById: string | null;
  archivedByName: string | null;
  links: { rentals: number; invoices: number; history: number; sms: number; leads: number; emails: number };
};

export type ArchiveFilters = { reason?: string | null; batch?: string | null; userId?: string | null; from?: Date | null; to?: Date | null; type?: string | null; q?: string | null };

export async function listArchive(f: ArchiveFilters): Promise<ArchiveRow[]> {
  const common = {
    archivedAt: { not: null, ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) },
    ...(f.reason ? { archiveReason: f.reason } : {}),
    ...(f.batch ? { archiveBatch: f.batch } : {}),
    ...(f.userId ? { archivedById: f.userId } : {}),
  };
  const [clients, leads, users] = await Promise.all([
    f.type === "lead"
      ? []
      : prisma.client.findMany({
          where: { ...common, ...(f.q ? { OR: [{ name: { contains: f.q } }, { city: { contains: f.q } }, { nip: { contains: f.q } }] } : {}) },
          select: {
            id: true,
            name: true,
            city: true,
            qualifiedAt: true,
            archivedAt: true,
            archiveReason: true,
            archiveNote: true,
            archiveBatch: true,
            archivedById: true,
            _count: { select: { rentals: true, invoices: true, history: true, messages: true, leads: true, emails: true } },
          },
        }),
    f.type === "client"
      ? []
      : prisma.lead.findMany({
          where: { ...common, ...(f.q ? { OR: [{ title: { contains: f.q } }, { contactEmail: { contains: f.q } }] } : {}) },
          select: {
            id: true,
            title: true,
            contactEmail: true,
            rentalId: true,
            archivedAt: true,
            archiveReason: true,
            archiveNote: true,
            archiveBatch: true,
            archivedById: true,
            client: { select: { name: true } },
          },
        }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const rows: ArchiveRow[] = [
    ...clients.map((c) => {
      const derived = c.qualifiedAt || c._count.rentals > 0 || c._count.history > 0 || c._count.invoices > 0;
      return {
        type: "client" as const,
        id: c.id,
        kindLabel: derived ? ("klient" as const) : ("kontakt z zapytania" as const),
        name: c.name,
        detail: c.city,
        reason: c.archiveReason as ArchiveReasonKey | null,
        note: c.archiveNote,
        batch: c.archiveBatch,
        archivedAt: c.archivedAt!.toISOString(),
        archivedById: c.archivedById,
        archivedByName: c.archivedById ? (userName.get(c.archivedById) ?? null) : null,
        links: { rentals: c._count.rentals, invoices: c._count.invoices, history: c._count.history, sms: c._count.messages, leads: c._count.leads, emails: c._count.emails },
      };
    }),
    ...leads.map((l) => ({
      type: "lead" as const,
      id: l.id,
      kindLabel: "sygnał" as const,
      name: l.title,
      detail: l.client?.name ?? l.contactEmail,
      reason: l.archiveReason as ArchiveReasonKey | null,
      note: l.archiveNote,
      batch: l.archiveBatch,
      archivedAt: l.archivedAt!.toISOString(),
      archivedById: l.archivedById,
      archivedByName: l.archivedById ? (userName.get(l.archivedById) ?? null) : null,
      links: { rentals: l.rentalId ? 1 : 0, invoices: 0, history: 0, sms: 0, leads: 0, emails: 0 },
    })),
  ];
  return rows.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

// --- trwałe usunięcie ---

export async function deleteArchived(type: ArchiveType, ids: string[], actor: Actor): Promise<{ deleted: number; blocked: number }> {
  let deleted = 0;
  let blocked = 0;
  for (const id of ids) {
    const r = type === "client" ? await deleteClient(id, actor) : await deleteLead(id, actor);
    if (r) {
      deleted++;
      blocked += r.blocked;
    }
  }
  return { deleted, blocked };
}

type BlockRow = { kind: "CONTACT" | "COMPANY" | "DEAL"; hubspotId: string; label: string | null; reason: string | null; createdById: string };

async function deleteClient(id: string, actor: Actor): Promise<{ blocked: number } | null> {
  const c = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      archivedAt: true,
      archiveReason: true,
      hubspotCompanyId: true,
      contacts: { select: { hubspotContactId: true } },
      leads: { select: { id: true, hubspotDealId: true } },
    },
  });
  if (!c) return null;
  if (!c.archivedAt) throw new PorzadkiError(`„${c.name}” nie jest w archiwum — najpierw archiwizacja.`, 409);
  const blocks: BlockRow[] = [
    ...(c.hubspotCompanyId ? [{ kind: "COMPANY" as const, hubspotId: c.hubspotCompanyId, label: c.name, reason: c.archiveReason, createdById: actor.userId }] : []),
    ...c.contacts.filter((p) => p.hubspotContactId).map((p) => ({ kind: "CONTACT" as const, hubspotId: p.hubspotContactId!, label: c.name, reason: c.archiveReason, createdById: actor.userId })),
    ...c.leads.filter((l) => l.hubspotDealId).map((l) => ({ kind: "DEAL" as const, hubspotId: l.hubspotDealId!, label: c.name, reason: c.archiveReason, createdById: actor.userId })),
  ];
  await prisma.$transaction(async (tx) => {
    if (blocks.length) await tx.importBlock.createMany({ data: blocks, skipDuplicates: true });
    // Dane osobowe znikają naprawdę: sygnały (z osią czasu), notatki i
    // metadane e-maili klienta, osoby kontaktowe (kaskada), a w dzienniku —
    // wartości przed/po. Wynajmy, faktury i historia zostają, bez powiązania.
    await tx.lead.deleteMany({ where: { clientId: id } });
    await tx.leadActivity.deleteMany({ where: { clientId: id } });
    await tx.emailMessage.deleteMany({ where: { clientId: id } });
    await tx.changeLog.updateMany({ where: { clientId: id }, data: { before: null, after: null } });
    await tx.client.delete({ where: { id } });
    // Minimalny ślad: ID, nazwa, powód, kto, kiedy (clientId już nie istnieje).
    await tx.changeLog.create({
      data: {
        userId: actor.userId,
        clientName: c.name,
        entity: "CLIENT",
        entityId: id,
        operation: "DELETE",
        before: toLogValue({ id, nazwa: c.name, powod: c.archiveReason }),
        after: toLogValue({ blokadyHubSpot: blocks.length }),
      },
    });
  });
  return { blocked: blocks.length };
}

async function deleteLead(id: string, actor: Actor): Promise<{ blocked: number } | null> {
  const l = await prisma.lead.findUnique({ where: { id }, select: { id: true, title: true, clientId: true, archivedAt: true, archiveReason: true, hubspotDealId: true } });
  if (!l) return null;
  if (!l.archivedAt) throw new PorzadkiError(`Sygnał „${l.title}” nie jest w archiwum — najpierw archiwizacja.`, 409);
  await prisma.$transaction(async (tx) => {
    if (l.hubspotDealId) {
      await tx.importBlock.createMany({
        data: [{ kind: "DEAL", hubspotId: l.hubspotDealId, label: l.title, reason: l.archiveReason, createdById: actor.userId }],
        skipDuplicates: true,
      });
    }
    await tx.lead.delete({ where: { id } }); // oś czasu sygnału — kaskada
    await tx.changeLog.updateMany({ where: { entity: "LEAD", entityId: id }, data: { before: null, after: null } });
    await recordChanges(tx, { userId: actor.userId }, [
      { entity: "LEAD", entityId: id, clientId: l.clientId, operation: "DELETE", before: toLogValue({ id, nazwa: l.title, powod: l.archiveReason }), after: toLogValue({ blokadyHubSpot: l.hubspotDealId ? 1 : 0 }) },
    ]);
  });
  return { blocked: l.hubspotDealId ? 1 : 0 };
}
