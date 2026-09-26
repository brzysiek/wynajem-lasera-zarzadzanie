import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { parseClientPatch, parseContactInput } from "@/lib/clients/validate";
import { patchClient, patchContact } from "@/lib/clients/update";
import { mergeClients } from "@/lib/clients/merge";
import { toLogValue } from "@/lib/changelog/diff";
import { sameLogValue } from "@/lib/changelog/undo-rules";
import { archiveRecords } from "@/lib/porzadki/archive";
import type { ArchiveInput } from "@/lib/porzadki/archive-rules";
import { PorzadkiError, type Actor } from "@/lib/porzadki/proposals";
import { parseProposalItem, type ChangeProposalStatus, type ParsedProposal, type ProposalKind } from "@/lib/porzadki/proposal-rules";

// Kolejka propozycji zmian (Porządki, etap D). Agent zgłasza (hurtem),
// ADMIN akceptuje / odrzuca / poprawia wartość. Akceptacja od razu wykonuje
// zmianę tymi samymi funkcjami co panel (dziennik: wykonał = autor
// propozycji, zatwierdził = ADMIN). Klasy zatwierdzone na stałe wykonują się
// przy zgłoszeniu (tylko zmiany pól). Odrzucona propozycja blokuje ponowne
// zgłoszenie tej samej zmiany — agent dostaje komentarz odrzucenia.

export type ChangeProposalRow = {
  id: string;
  kind: ProposalKind;
  clientId: string | null;
  clientName: string | null;
  contactId: string | null;
  contactName: string | null;
  leadId: string | null;
  leadTitle: string | null;
  duplicateName: string | null; // MERGE: nazwa scalanego duplikatu
  field: string | null;
  currentValue: string | null;
  proposedValue: string | null;
  source: string;
  confidence: string;
  batch: string | null;
  changeClass: string | null;
  status: ChangeProposalStatus;
  autoApproved: boolean;
  authorName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  executedAt: string | null;
  executionError: string | null;
  edited: boolean;
  createdAt: string;
};

// --- zgłaszanie ---

// Wartość w panelu teraz (JSON, jak w dzienniku) — do porównań i widoku.
async function currentFor(p: { kind: string; clientId: string | null; contactId: string | null; field: string | null }): Promise<string | null> {
  if (p.kind === "FIELD" && p.clientId && p.field) {
    const c = await prisma.client.findUnique({ where: { id: p.clientId } });
    if (!c) throw new PorzadkiError("Nie znaleziono klienta.", 404);
    return toLogValue((c as unknown as Record<string, unknown>)[p.field]);
  }
  if (p.kind === "CONTACT_FIELD" && p.contactId && p.field) {
    const c = await prisma.clientContact.findFirst({ where: { id: p.contactId, clientId: p.clientId ?? undefined } });
    if (!c) throw new PorzadkiError("Nie znaleziono osoby kontaktowej tego klienta.", 404);
    return toLogValue((c as unknown as Record<string, unknown>)[p.field]);
  }
  return null;
}

// Proponowana wartość po normalizacji panelu (NIP same cyfry, telefon +48…),
// żeby ADMIN widział to, co faktycznie się zapisze.
function normalizeProposed(p: ParsedProposal): unknown {
  if (p.kind === "FIELD") {
    const r = parseClientPatch({ [p.field!]: p.proposed });
    if (!r.ok) throw new PorzadkiError(r.message);
    return (r.data as Record<string, unknown>)[p.field!] ?? null;
  }
  if (p.kind === "CONTACT_FIELD") {
    const r = parseContactInput({ [p.field!]: p.proposed }, { normalizePhone: normalizePolishPhone });
    if (!r.ok) throw new PorzadkiError(r.message);
    return (r.data as Record<string, unknown>)[p.field!] ?? null;
  }
  return p.proposed;
}

async function targetsExist(p: ParsedProposal) {
  if (p.clientId && !(await prisma.client.findUnique({ where: { id: p.clientId }, select: { id: true } }))) throw new PorzadkiError("Nie znaleziono klienta.", 404);
  if (p.leadId && !(await prisma.lead.findUnique({ where: { id: p.leadId }, select: { id: true } }))) throw new PorzadkiError("Sygnał nie istnieje.", 404);
  if (p.kind === "MERGE") {
    const dup = (p.proposed as { duplicateId: string }).duplicateId;
    if (!(await prisma.client.findUnique({ where: { id: dup }, select: { id: true } }))) throw new PorzadkiError("Duplikat nie istnieje.", 404);
  }
}

export type SubmitResult = { index: number; ok: boolean; id?: string; status?: ChangeProposalStatus; message?: string };

export async function submitProposals(items: unknown[], author: Actor): Promise<SubmitResult[]> {
  if (!Array.isArray(items) || items.length === 0) throw new PorzadkiError("Podaj listę propozycji.");
  if (items.length > 500) throw new PorzadkiError("Maks. 500 propozycji w jednym zgłoszeniu.");
  const autoClasses = new Set((await prisma.autoApprovedClass.findMany({ select: { key: true } })).map((c) => c.key));
  const out: SubmitResult[] = [];

  for (const [index, raw] of items.entries()) {
    try {
      if (!raw || typeof raw !== "object") throw new PorzadkiError("Propozycja musi być obiektem.");
      const parsed = parseProposalItem(raw as Record<string, unknown>);
      if (!parsed.ok) throw new PorzadkiError(parsed.message);
      const p = parsed.value;
      await targetsExist(p);
      const proposedValue = toLogValue(normalizeProposed(p));
      const currentValue = await currentFor(p);
      if (currentValue !== null && sameLogValue(currentValue, proposedValue)) throw new PorzadkiError("Bez zmiany — w panelu jest już ta wartość.");

      const same = { kind: p.kind, clientId: p.clientId, contactId: p.contactId, leadId: p.leadId, field: p.field, proposedValue };
      const pending = await prisma.changeProposal.findFirst({ where: { ...same, status: "PENDING" }, select: { id: true } });
      if (pending) throw new PorzadkiError(`Ta sama propozycja już czeka (${pending.id}).`);
      const rejected = await prisma.changeProposal.findFirst({ where: { ...same, status: "REJECTED" }, orderBy: { decidedAt: "desc" }, select: { decisionComment: true } });
      if (rejected) throw new PorzadkiError(`Ta zmiana została już odrzucona${rejected.decisionComment ? `: „${rejected.decisionComment}”` : ""} — nie proponuj jej ponownie.`);

      const row = await prisma.changeProposal.create({
        data: {
          ...same,
          currentValue,
          source: p.provenance.source ?? "",
          confidence: p.provenance.confidence ?? "MEDIUM",
          batch: p.provenance.batch,
          changeClass: p.changeClass,
          authorId: author.userId,
        },
      });

      // Klasa zatwierdzona na stałe — tylko zmiany pól, wykonanie od razu.
      if (p.changeClass && autoClasses.has(p.changeClass) && (p.kind === "FIELD" || p.kind === "CONTACT_FIELD")) {
        const res = await execute(row.id, null);
        await prisma.changeProposal.update({
          where: { id: row.id },
          data: res.ok
            ? { status: "ACCEPTED", autoApproved: true, decidedAt: new Date(), executedAt: new Date(), decisionComment: `automatycznie: klasa ${p.changeClass}` }
            : { executionError: res.message },
        });
        out.push({ index, ok: true, id: row.id, status: res.ok ? "ACCEPTED" : "PENDING", ...(res.ok ? {} : { message: `Nie wykonano automatycznie: ${res.message}` }) });
      } else {
        out.push({ index, ok: true, id: row.id, status: "PENDING" });
      }
    } catch (err) {
      if (err instanceof PorzadkiError) out.push({ index, ok: false, message: err.message });
      else throw err;
    }
  }
  return out;
}

// --- wykonanie ---

async function execute(id: string, approvedById: string | null): Promise<{ ok: true } | { ok: false; message: string }> {
  const p = await prisma.changeProposal.findUnique({ where: { id } });
  if (!p) return { ok: false, message: "Propozycja nie istnieje." };
  const author = p.authorId ? await prisma.user.findUnique({ where: { id: p.authorId }, select: { id: true, role: true } }) : null;
  // Wykonał = autor propozycji (z jego uprawnieniami); bez autora — zatwierdzający.
  const actor = author ? { userId: author.id, role: author.role } : { userId: approvedById ?? "", role: "ADMIN" };
  const provenance = { changeSource: p.source, changeConfidence: p.confidence, changeBatch: p.batch ?? "" };
  const value = p.proposedValue == null ? null : JSON.parse(p.proposedValue);

  if (p.kind === "FIELD") {
    const r = await patchClient(p.clientId!, { [p.field!]: value, ...provenance }, actor, { approvedById });
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }
  if (p.kind === "CONTACT_FIELD") {
    const r = await patchContact(p.clientId!, p.contactId!, { [p.field!]: value, ...provenance }, actor, { approvedById });
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }
  if (p.kind === "MERGE") {
    const r = await mergeClients(p.clientId!, (value as { duplicateId: string }).duplicateId, provenance, actor, { approvedById });
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }
  // ARCHIVE — archiwizuje zatwierdzający ADMIN (agent nie archiwizuje sam).
  const input = value as ArchiveInput;
  const n = await archiveRecords(
    p.leadId ? "lead" : "client",
    [p.leadId ?? p.clientId!],
    { reason: input.reason, note: `${input.note} (propozycja agenta, źródło: ${p.source})`, batch: p.batch },
    { userId: approvedById ?? actor.userId, role: "ADMIN" },
    { approvedById },
  );
  return n > 0 ? { ok: true } : { ok: false, message: "Rekord jest już w archiwum albo nie istnieje." };
}

// --- decyzje ADMIN ---

export type DecisionResult = { accepted: number; rejected: number; conflicts: { id: string; current: string | null }[]; failed: { id: string; message: string }[] };

export async function decideProposals(ids: string[], action: "accept" | "reject", admin: Actor, opts: { comment?: string | null; force?: boolean } = {}): Promise<DecisionResult> {
  const result: DecisionResult = { accepted: 0, rejected: 0, conflicts: [], failed: [] };
  const rows = await prisma.changeProposal.findMany({ where: { id: { in: ids.slice(0, 500) }, status: "PENDING" } });
  const comment = opts.comment?.trim() || null;
  for (const p of rows) {
    if (action === "reject") {
      await prisma.changeProposal.update({ where: { id: p.id }, data: { status: "REJECTED", decidedById: admin.userId, decidedAt: new Date(), decisionComment: comment } });
      result.rejected++;
      continue;
    }
    // Wartość zmieniła się od zgłoszenia — bez „force” pomijamy (konflikt).
    const now = await currentFor(p).catch(() => null);
    if (!opts.force && p.currentValue !== null && now !== null && !sameLogValue(now, p.currentValue)) {
      result.conflicts.push({ id: p.id, current: now });
      continue;
    }
    const res = await execute(p.id, admin.userId);
    if (!res.ok) {
      await prisma.changeProposal.update({ where: { id: p.id }, data: { executionError: res.message } });
      result.failed.push({ id: p.id, message: res.message });
      continue;
    }
    await prisma.changeProposal.update({
      where: { id: p.id },
      data: { status: "ACCEPTED", decidedById: admin.userId, decidedAt: new Date(), decisionComment: comment, executedAt: new Date(), executionError: null },
    });
    result.accepted++;
  }
  return result;
}

// Poprawka wartości przez ADMIN przed akceptacją (tylko zmiany pól).
export async function editProposalValue(id: string, value: unknown, admin: Actor) {
  const p = await prisma.changeProposal.findUnique({ where: { id } });
  if (!p) throw new PorzadkiError("Propozycja nie istnieje.", 404);
  if (p.status !== "PENDING") throw new PorzadkiError("Poprawiać można tylko oczekujące propozycje.", 409);
  if (p.kind !== "FIELD" && p.kind !== "CONTACT_FIELD") throw new PorzadkiError("Poprawić można tylko wartość pola.");
  const proposedValue = toLogValue(normalizeProposed({ kind: p.kind, field: p.field, proposed: value } as ParsedProposal));
  await prisma.changeProposal.update({ where: { id }, data: { proposedValue, editedById: admin.userId, executionError: null } });
}

// --- lista ---

export type ChangeProposalFilters = { status?: string | null; batch?: string | null; clientId?: string | null; confidence?: string | null; kind?: string | null; executed?: boolean | null };

export async function listChangeProposals(f: ChangeProposalFilters): Promise<ChangeProposalRow[]> {
  const rows = await prisma.changeProposal.findMany({
    where: {
      ...(f.status ? { status: f.status } : {}),
      ...(f.batch ? { batch: f.batch } : {}),
      ...(f.clientId ? { clientId: f.clientId } : {}),
      ...(f.confidence ? { confidence: f.confidence } : {}),
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.executed === true ? { executedAt: { not: null } } : f.executed === false ? { executedAt: null } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: 2000,
    include: { client: { select: { name: true } } },
  });
  const userIds = [...new Set(rows.flatMap((r) => [r.authorId, r.decidedById]).filter((x): x is string => !!x))];
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x))];
  const leadIds = [...new Set(rows.map((r) => r.leadId).filter((x): x is string => !!x))];
  const dupId = (r: { kind: string; proposedValue: string | null }) =>
    r.kind === "MERGE" && r.proposedValue ? ((JSON.parse(r.proposedValue) as { duplicateId?: string }).duplicateId ?? null) : null;
  const dupIds = [...new Set(rows.map(dupId).filter((x): x is string => !!x))];
  const [users, contacts, leads, dups] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    contactIds.length ? prisma.clientContact.findMany({ where: { id: { in: contactIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [],
    leadIds.length ? prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, title: true } }) : [],
    dupIds.length ? prisma.client.findMany({ where: { id: { in: dupIds } }, select: { id: true, name: true } }) : [],
  ]);
  const dupName = new Map(dups.map((c) => [c.id, c.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const contactName = new Map(contacts.map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "osoba"]));
  const leadTitle = new Map(leads.map((l) => [l.id, l.title]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as ProposalKind,
    clientId: r.clientId,
    clientName: r.client?.name ?? null,
    contactId: r.contactId,
    contactName: r.contactId ? (contactName.get(r.contactId) ?? null) : null,
    leadId: r.leadId,
    leadTitle: r.leadId ? (leadTitle.get(r.leadId) ?? null) : null,
    duplicateName: dupId(r) ? (dupName.get(dupId(r)!) ?? null) : null,
    field: r.field,
    currentValue: r.currentValue,
    proposedValue: r.proposedValue,
    source: r.source,
    confidence: r.confidence,
    batch: r.batch,
    changeClass: r.changeClass,
    status: r.status as ChangeProposalStatus,
    autoApproved: r.autoApproved,
    authorName: r.authorId ? (userName.get(r.authorId) ?? null) : null,
    decidedByName: r.decidedById ? (userName.get(r.decidedById) ?? null) : null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionComment: r.decisionComment,
    executedAt: r.executedAt?.toISOString() ?? null,
    executionError: r.executionError,
    edited: !!r.editedById,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function countPendingForClient(clientId: string): Promise<number> {
  return prisma.changeProposal.count({ where: { clientId, status: "PENDING" } });
}

// --- klasy zatwierdzane automatycznie ---

export async function listAutoClasses() {
  const rows = await prisma.autoApprovedClass.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({ key: r.key, label: r.label, createdAt: r.createdAt.toISOString() }));
}
