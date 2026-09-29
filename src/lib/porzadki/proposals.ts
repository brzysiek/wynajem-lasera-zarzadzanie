import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AreaKey, CauseKey, PriorityKey, ProposalStatusKey, ProposalTypeKey, RelationKey } from "@/lib/porzadki/labels";
import { OPEN_STATUSES } from "@/lib/porzadki/labels";
import { syncDeployedProposals } from "@/lib/porzadki/deployed";
import {
  canEditProposal,
  canSetStatus,
  similarProposals,
  sortProposals,
  type ProposalExport,
  type ProposalInput,
} from "@/lib/porzadki/rules";

// Wnioski (moduł „Porządki”) — odczyt i zapis. Uprawnienia ról sprawdzane
// tutaj (canSetStatus / canEditProposal), żeby UI i API agenta miały tę samą
// regułę.

export class PorzadkiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type Actor = { userId: string; role: string };

export type ProposalRow = {
  id: string;
  number: number;
  title: string;
  area: AreaKey;
  type: ProposalTypeKey;
  status: ProposalStatusKey;
  priority: PriorityKey;
  blocksCleanup: boolean;
  scale: string | null;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  clientCount: number;
  // Wniosek 30: commit, którego tytuł wymienia ten wniosek (podpowiedź „✓ Zrobione”).
  deployed: { commit: string; at: string } | null;
};

export type ProposalDetail = ProposalRow & {
  problem: string | null;
  evidence: string | null;
  proposal: string | null;
  causes: CauseKey[];
  priorityReason: string | null;
  decision: string | null;
  clients: { id: string; name: string }[];
  relations: { id: string; kind: RelationKey; direction: "out" | "in"; otherId: string; otherNumber: number; otherTitle: string; otherStatus: ProposalStatusKey }[];
  statuses: { id: string; from: ProposalStatusKey | null; to: ProposalStatusKey; comment: string | null; userName: string | null; at: string }[];
  comments: { id: string; body: string; userName: string | null; at: string }[];
  remarks: { id: string; body: string }[];
  canEdit: boolean;
};

export type ProposalFilters = {
  status?: string | null; // „open” = otwarte, albo kod statusu
  area?: string | null;
  type?: string | null;
  priority?: string | null;
  blocks?: boolean | null;
  authorId?: string | null;
  q?: string | null;
  clientId?: string | null;
};

const ROW_INCLUDE = {
  author: { select: { name: true } },
  _count: { select: { comments: true, clients: true } },
} as const;

type RowSource = Prisma.ProposalGetPayload<{ include: typeof ROW_INCLUDE }>;

function toRow(p: RowSource): ProposalRow {
  return {
    id: p.id,
    number: p.number,
    title: p.title,
    area: p.area as AreaKey,
    type: p.type as ProposalTypeKey,
    status: p.status as ProposalStatusKey,
    priority: p.priority as PriorityKey,
    blocksCleanup: p.blocksCleanup,
    scale: p.scale,
    authorId: p.authorId,
    authorName: p.author?.name ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    commentCount: p._count.comments,
    clientCount: p._count.clients,
    deployed: p.deployedCommit ? { commit: p.deployedCommit, at: (p.deployedAt ?? p.updatedAt).toISOString() } : null,
  };
}

function whereFor(f: ProposalFilters): Prisma.ProposalWhereInput {
  const where: Prisma.ProposalWhereInput = {};
  if (f.status === "open") where.status = { in: OPEN_STATUSES };
  else if (f.status) where.status = f.status;
  if (f.area) where.area = f.area;
  if (f.type) where.type = f.type;
  if (f.priority) where.priority = f.priority;
  if (f.blocks != null) where.blocksCleanup = f.blocks;
  if (f.authorId) where.authorId = f.authorId;
  if (f.clientId) where.clients = { some: { clientId: f.clientId } };
  if (f.q) {
    const q = f.q.trim();
    const n = Number(q.replace(/^W-0*/i, ""));
    where.OR = [
      { title: { contains: q } },
      { problem: { contains: q } },
      { proposal: { contains: q } },
      { evidence: { contains: q } },
      ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : []),
    ];
  }
  return where;
}

export async function listProposals(f: ProposalFilters = {}): Promise<{ rows: ProposalRow[]; counts: Record<string, number> }> {
  await syncDeployedProposals();
  const [rows, grouped] = await Promise.all([
    prisma.proposal.findMany({ where: whereFor(f), include: ROW_INCLUDE, take: 1000 }),
    prisma.proposal.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  return { rows: sortProposals(rows.map(toRow)), counts };
}

export async function loadProposal(id: string, actor: Actor): Promise<ProposalDetail | null> {
  const p = await prisma.proposal.findUnique({
    where: { id },
    include: {
      ...ROW_INCLUDE,
      clients: { include: { client: { select: { id: true, name: true } } } },
      relations: { include: { to: { select: { id: true, number: true, title: true, status: true } } } },
      relatedBy: { include: { from: { select: { id: true, number: true, title: true, status: true } } } },
      statuses: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } },
      comments: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } },
      remarks: { select: { id: true, body: true } },
    },
  });
  if (!p) return null;
  const row = toRow(p);
  return {
    ...row,
    problem: p.problem,
    evidence: p.evidence,
    proposal: p.proposal,
    causes: Array.isArray(p.causes) ? (p.causes as CauseKey[]) : [],
    priorityReason: p.priorityReason,
    decision: p.decision,
    clients: p.clients.map((c) => c.client).sort((a, b) => a.name.localeCompare(b.name, "pl")),
    relations: [
      ...p.relations.map((r) => ({ id: r.id, kind: r.kind as RelationKey, direction: "out" as const, otherId: r.to.id, otherNumber: r.to.number, otherTitle: r.to.title, otherStatus: r.to.status as ProposalStatusKey })),
      ...p.relatedBy.map((r) => ({ id: r.id, kind: r.kind as RelationKey, direction: "in" as const, otherId: r.from.id, otherNumber: r.from.number, otherTitle: r.from.title, otherStatus: r.from.status as ProposalStatusKey })),
    ],
    statuses: p.statuses.map((s) => ({ id: s.id, from: (s.fromStatus as ProposalStatusKey) ?? null, to: s.toStatus as ProposalStatusKey, comment: s.comment, userName: s.user?.name ?? null, at: s.createdAt.toISOString() })),
    comments: p.comments.map((c) => ({ id: c.id, body: c.body, userName: c.user?.name ?? null, at: c.createdAt.toISOString() })),
    remarks: p.remarks,
    canEdit: canEditProposal(actor.role, actor.userId, { authorId: p.authorId, status: row.status }),
  };
}

export async function findSimilar(title: string, area: string, excludeId?: string) {
  const open = await prisma.proposal.findMany({
    where: { status: { in: OPEN_STATUSES }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, number: true, title: true, area: true, status: true },
  });
  return similarProposals(title, area, open);
}

async function existingClientIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function createProposal(input: ProposalInput, actor: Actor, status: "NOWY" | "DO_DECYZJI" = "NOWY") {
  const clientIds = await existingClientIds(input.clientIds);
  const { clientIds: _unused, causes, ...data } = input;
  void _unused;
  const p = await prisma.$transaction(async (tx) => {
    const created = await tx.proposal.create({
      data: {
        ...data,
        causes: causes.length ? causes : Prisma.DbNull,
        status,
        authorId: actor.userId,
        clients: { create: clientIds.map((clientId) => ({ clientId })) },
      },
    });
    await tx.proposalStatusChange.create({ data: { proposalId: created.id, userId: actor.userId, fromStatus: null, toStatus: status } });
    return created;
  });
  return p;
}

export async function updateProposal(id: string, input: Partial<ProposalInput>, actor: Actor) {
  const p = await prisma.proposal.findUnique({ where: { id }, select: { authorId: true, status: true } });
  if (!p) throw new PorzadkiError("Wniosek nie istnieje.", 404);
  if (!canEditProposal(actor.role, actor.userId, { authorId: p.authorId, status: p.status as ProposalStatusKey })) {
    throw new PorzadkiError("Ten wniosek może zmienić jego autor (dopóki czeka na decyzję) albo administrator.", 403);
  }
  const { clientIds, causes, ...data } = input;
  const ids = clientIds ? await existingClientIds(clientIds) : null;
  await prisma.$transaction(async (tx) => {
    await tx.proposal.update({
      where: { id },
      data: { ...data, ...(causes ? { causes: causes.length ? causes : Prisma.DbNull } : {}) },
    });
    if (ids) {
      await tx.proposalClient.deleteMany({ where: { proposalId: id } });
      if (ids.length) await tx.proposalClient.createMany({ data: ids.map((clientId) => ({ proposalId: id, clientId })) });
    }
  });
}

export async function setProposalStatus(
  id: string,
  to: ProposalStatusKey,
  actor: Actor,
  opts: { comment?: string | null; duplicateOfId?: string | null },
) {
  const p = await prisma.proposal.findUnique({ where: { id }, select: { status: true } });
  if (!p) throw new PorzadkiError("Wniosek nie istnieje.", 404);
  const from = p.status as ProposalStatusKey;
  if (from === to) return;
  if (!canSetStatus(actor.role, from, to)) {
    throw new PorzadkiError("Ten status ustawia administrator (decyzja). Możesz przełączać tylko „nowy” i „do decyzji”.", 403);
  }
  let duplicateOf: string | null = null;
  if (to === "DUPLIKAT") {
    if (!opts.duplicateOfId || opts.duplicateOfId === id) throw new PorzadkiError("Wskaż wniosek główny (duplikat czego?).");
    const main = await prisma.proposal.findUnique({ where: { id: opts.duplicateOfId }, select: { id: true } });
    if (!main) throw new PorzadkiError("Wniosek główny nie istnieje.", 404);
    duplicateOf = main.id;
  }
  const comment = opts.comment?.trim() || null;
  await prisma.$transaction(async (tx) => {
    await tx.proposal.update({ where: { id }, data: { status: to, ...(comment && actor.role === "ADMIN" ? { decision: comment } : {}) } });
    await tx.proposalStatusChange.create({ data: { proposalId: id, userId: actor.userId, fromStatus: from, toStatus: to, comment } });
    if (duplicateOf) {
      await tx.proposalRelation.upsert({
        where: { fromId_toId_kind: { fromId: id, toId: duplicateOf, kind: "DUPLICATE_OF" } },
        create: { fromId: id, toId: duplicateOf, kind: "DUPLICATE_OF" },
        update: {},
      });
    }
  });
}

// Wniosek 30: zmiana statusu wielu wniosków naraz (lista /wnioski, pasek
// hurtowy i przycisk w wierszu, także „Cofnij”) — każdy wpis trafia do
// historii statusów. Zwraca, co faktycznie zmieniono (z → na) do cofnięcia.
export async function setProposalStatuses(
  items: { id: string; status: ProposalStatusKey }[],
  actor: Actor,
  opts: { comment?: string | null; duplicateOfId?: string | null },
): Promise<{ id: string; from: ProposalStatusKey; to: ProposalStatusKey }[]> {
  if (actor.role !== "ADMIN") throw new PorzadkiError("Statusy wniosków ustawia administrator.", 403);
  const current = await prisma.proposal.findMany({ where: { id: { in: items.map((i) => i.id) } }, select: { id: true, status: true } });
  const from = new Map(current.map((c) => [c.id, c.status as ProposalStatusKey]));
  const changed: { id: string; from: ProposalStatusKey; to: ProposalStatusKey }[] = [];
  for (const it of items) {
    const f = from.get(it.id);
    if (!f || f === it.status) continue;
    await setProposalStatus(it.id, it.status, actor, opts);
    changed.push({ id: it.id, from: f, to: it.status });
  }
  return changed;
}

export async function addProposalComment(id: string, body: string, actor: Actor) {
  const text = body.trim().slice(0, 10000);
  if (!text) throw new PorzadkiError("Wpisz treść komentarza.");
  const p = await prisma.proposal.findUnique({ where: { id }, select: { id: true } });
  if (!p) throw new PorzadkiError("Wniosek nie istnieje.", 404);
  await prisma.proposalComment.create({ data: { proposalId: id, userId: actor.userId, body: text } });
}

export async function addProposalRelation(id: string, kind: RelationKey, toId: string, actor: Actor) {
  const [p, other] = await Promise.all([
    prisma.proposal.findUnique({ where: { id }, select: { authorId: true, status: true } }),
    prisma.proposal.findUnique({ where: { id: toId }, select: { id: true } }),
  ]);
  if (!p || !other) throw new PorzadkiError("Wniosek nie istnieje.", 404);
  if (id === toId) throw new PorzadkiError("Wniosek nie może wskazywać sam na siebie.");
  if (!canEditProposal(actor.role, actor.userId, { authorId: p.authorId, status: p.status as ProposalStatusKey })) {
    throw new PorzadkiError("Powiązania zmienia autor wniosku albo administrator.", 403);
  }
  await prisma.proposalRelation.upsert({
    where: { fromId_toId_kind: { fromId: id, toId, kind } },
    create: { fromId: id, toId, kind },
    update: {},
  });
}

export async function removeProposalRelation(relationId: string, actor: Actor) {
  const r = await prisma.proposalRelation.findUnique({ where: { id: relationId }, include: { from: { select: { authorId: true, status: true } } } });
  if (!r) throw new PorzadkiError("Powiązanie nie istnieje.", 404);
  if (!canEditProposal(actor.role, actor.userId, { authorId: r.from.authorId, status: r.from.status as ProposalStatusKey })) {
    throw new PorzadkiError("Powiązania zmienia autor wniosku albo administrator.", 403);
  }
  await prisma.proposalRelation.delete({ where: { id: relationId } });
}

export async function loadProposalsForExport(f: ProposalFilters): Promise<ProposalExport[]> {
  const rows = await prisma.proposal.findMany({
    where: whereFor(f),
    include: {
      author: { select: { name: true } },
      clients: { include: { client: { select: { name: true } } } },
      relations: { include: { to: { select: { number: true } } } },
      comments: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } },
    },
    take: 1000,
  });
  const list = rows.map((p) => ({
    number: p.number,
    title: p.title,
    area: p.area as AreaKey,
    type: p.type as ProposalTypeKey,
    status: p.status as ProposalStatusKey,
    priority: p.priority as PriorityKey,
    priorityReason: p.priorityReason,
    blocksCleanup: p.blocksCleanup,
    scale: p.scale,
    causes: Array.isArray(p.causes) ? (p.causes as CauseKey[]) : [],
    problem: p.problem,
    evidence: p.evidence,
    proposal: p.proposal,
    decision: p.decision,
    author: p.author?.name ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    clients: p.clients.map((c) => c.client.name),
    relations: p.relations.map((r) => ({ kind: r.kind as RelationKey, number: r.to.number })),
    comments: p.comments.map((c) => ({ author: c.user?.name ?? null, createdAt: c.createdAt.toISOString(), body: c.body })),
  }));
  return sortProposals(list);
}
