import { prisma } from "@/lib/prisma";
import { archiveRecords } from "@/lib/porzadki/archive";
import type { ArchiveReasonKey } from "@/lib/porzadki/labels";
import { ARCHIVE_2025, FUNNEL_FROM } from "@/lib/leads/funnel";
import { STAGE_LABEL, TYPE_LABEL } from "@/lib/leads/labels";

// Lejek, prace jednorazowe (wniosek 18, pkt 10): archiwum „2025 – bez
// kontaktu” (do potwierdzenia przez Tomka — lista, potem przycisk) i
// zdublowane otwarte sygnały u jednego klienta (lista w Porządkach; agent
// zgłasza archiwizację duplikatu, nic nie scala się samo).

const OPEN = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"] as const;

export type Archive2025Candidate = {
  id: string;
  title: string;
  type: string;
  stage: string;
  createdAt: string;
  contacted: boolean;
  clientId: string | null;
  who: string | null;
  phone: string | null;
  email: string | null;
};

// Otwarte sygnały sprzed 2026. Domyślnie do archiwum idą te bez kontaktu;
// z kontaktem są na liście do ręcznego zaznaczenia.
export async function listArchive2025Candidates(): Promise<Archive2025Candidate[]> {
  const rows = await prisma.lead.findMany({
    where: { archivedAt: null, stage: { in: [...OPEN] }, createdAt: { lt: FUNNEL_FROM } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, type: true, stage: true, createdAt: true, firstContactAt: true, clientId: true, contactName: true, contactPhone: true, contactEmail: true, client: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    type: TYPE_LABEL[r.type],
    stage: STAGE_LABEL[r.stage],
    createdAt: r.createdAt.toISOString(),
    contacted: !!r.firstContactAt,
    clientId: r.clientId,
    who: r.client?.name ?? r.contactName,
    phone: r.contactPhone,
    email: r.contactEmail,
  }));
}

export async function archive2025(ids: string[], adminId: string): Promise<number> {
  // Tylko kandydaci (sprzed 2026, otwarci) — reszta identyfikatorów ignorowana.
  const ok = await prisma.lead.findMany({ where: { id: { in: ids }, archivedAt: null, stage: { in: [...OPEN] }, createdAt: { lt: FUNNEL_FROM } }, select: { id: true } });
  if (!ok.length) return 0;
  return archiveRecords(
    "lead",
    ok.map((l) => l.id),
    { reason: ARCHIVE_2025 as ArchiveReasonKey, note: "Sygnał sprzed 2026 bez kontaktu — do kampanii przed sezonem (lejek, decyzja 27.09.2026).", batch: "ARCHIWUM-2025" },
    { userId: adminId, role: "ADMIN" },
  );
}

export type LeadDuplicate = { clientId: string; clientName: string; leads: { id: string; title: string; stage: string; createdAt: string; ownerName: string | null }[] };

export async function listLeadDuplicates(): Promise<LeadDuplicate[]> {
  const groups = await prisma.lead.groupBy({ by: ["clientId"], where: { archivedAt: null, stage: { in: [...OPEN] }, clientId: { not: null } }, _count: { _all: true }, having: { clientId: { _count: { gt: 1 } } } });
  if (!groups.length) return [];
  const leads = await prisma.lead.findMany({
    where: { archivedAt: null, stage: { in: [...OPEN] }, clientId: { in: groups.map((g) => g.clientId!) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, stage: true, createdAt: true, clientId: true, owner: { select: { name: true } }, client: { select: { name: true, shortName: true } } },
  });
  const by = new Map<string, LeadDuplicate>();
  for (const l of leads) {
    const g = by.get(l.clientId!) ?? { clientId: l.clientId!, clientName: l.client?.shortName ?? l.client?.name ?? "—", leads: [] };
    g.leads.push({ id: l.id, title: l.title, stage: STAGE_LABEL[l.stage], createdAt: l.createdAt.toISOString(), ownerName: l.owner?.name ?? null });
    by.set(l.clientId!, g);
  }
  return [...by.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, "pl"));
}
