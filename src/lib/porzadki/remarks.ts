import { prisma } from "@/lib/prisma";
import type { AreaKey, RemarkStatusKey } from "@/lib/porzadki/labels";
import { areaListText, findArea, loadAreas } from "@/lib/porzadki/areas";
import { PorzadkiError, createProposal, type Actor } from "@/lib/porzadki/proposals";
import { parseProposalInput, type ProposalInput } from "@/lib/porzadki/rules";

// Uwagi (moduł „Porządki”) — obserwacje bez workflow. Autor albo ADMIN
// zmienia treść i status; przekształcenie we wniosek kopiuje pola i zostawia
// w uwadze link do wniosku.

export type RemarkRow = {
  id: string;
  body: string;
  area: AreaKey | null;
  evidence: string | null;
  status: RemarkStatusKey;
  clientId: string | null;
  clientName: string | null;
  leadId: string | null;
  leadTitle: string | null;
  proposalId: string | null;
  proposalNumber: number | null;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  canEdit: boolean;
};

export type RemarkInput = { body: string; area: AreaKey | null; evidence: string | null; clientId: string | null; leadId: string | null };

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

export function parseRemarkInput(body: Record<string, unknown>, partial: boolean): Result<Partial<RemarkInput>> {
  const out: Partial<RemarkInput> = {};
  const has = (k: string) => k in body;
  const text = (v: unknown, max = 20000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  if (!partial || has("body")) {
    const b = text(body.body);
    if (!b) return { ok: false, message: "Wpisz treść uwagi." };
    out.body = b;
  }
  if (!partial || has("area")) {
    const a = body.area ?? null;
    // Kod ze słownika proposal_areas — istnienie sprawdza zapis (checkLinks).
    if (a !== null && (typeof a !== "string" || !/^[A-Z_]{2,32}$/.test(a))) return { ok: false, message: "Obszar: kod obszaru (np. KLIENCI) albo brak." };
    out.area = a as AreaKey | null;
  }
  if (!partial || has("evidence")) out.evidence = text(body.evidence);
  if (!partial || has("clientId")) out.clientId = text(body.clientId, 64);
  if (!partial || has("leadId")) out.leadId = text(body.leadId, 64);
  return { ok: true, data: out };
}

const canEditRemark = (actor: Actor, authorId: string | null) => actor.role === "ADMIN" || authorId === actor.userId;

export async function listRemarks(f: { status?: string | null; area?: string | null; clientId?: string | null; q?: string | null }, actor: Actor): Promise<RemarkRow[]> {
  const rows = await prisma.remark.findMany({
    where: {
      ...(f.status ? { status: f.status } : {}),
      ...(f.area ? { area: f.area } : {}),
      ...(f.clientId ? { clientId: f.clientId } : {}),
      ...(f.q ? { OR: [{ body: { contains: f.q } }, { evidence: { contains: f.q } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
    include: {
      client: { select: { name: true } },
      lead: { select: { title: true } },
      proposal: { select: { number: true } },
      author: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    area: (r.area as AreaKey) ?? null,
    evidence: r.evidence,
    status: r.status as RemarkStatusKey,
    clientId: r.clientId,
    clientName: r.client?.name ?? null,
    leadId: r.leadId,
    leadTitle: r.lead?.title ?? null,
    proposalId: r.proposalId,
    proposalNumber: r.proposal?.number ?? null,
    authorId: r.authorId,
    authorName: r.author?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    canEdit: canEditRemark(actor, r.authorId),
  }));
}

async function checkLinks(input: Partial<RemarkInput>) {
  if (input.area && !(await findArea(input.area))) throw new PorzadkiError(`Obszar: ${areaListText(await loadAreas())}.`);
  if (input.clientId && !(await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true } }))) {
    throw new PorzadkiError("Klient nie istnieje.", 404);
  }
  if (input.leadId && !(await prisma.lead.findUnique({ where: { id: input.leadId }, select: { id: true } }))) {
    throw new PorzadkiError("Sygnał nie istnieje.", 404);
  }
}

export async function createRemark(input: RemarkInput, actor: Actor) {
  await checkLinks(input);
  // Uwaga do sygnału bez wskazanego klienta — przypinamy też do klienta sygnału.
  let clientId = input.clientId;
  if (!clientId && input.leadId) clientId = (await prisma.lead.findUnique({ where: { id: input.leadId }, select: { clientId: true } }))?.clientId ?? null;
  return prisma.remark.create({ data: { ...input, clientId, authorId: actor.userId } });
}

export async function updateRemark(id: string, input: Partial<RemarkInput> & { status?: RemarkStatusKey }, actor: Actor) {
  const r = await prisma.remark.findUnique({ where: { id }, select: { authorId: true } });
  if (!r) throw new PorzadkiError("Uwaga nie istnieje.", 404);
  if (!canEditRemark(actor, r.authorId)) throw new PorzadkiError("Uwagę zmienia jej autor albo administrator.", 403);
  await checkLinks(input);
  await prisma.remark.update({ where: { id }, data: input });
}

// Uwaga → wniosek: tytuł z pierwszego zdania, treść jako problem, dowód i
// klient kopiowane. Obszar i typ z body (obszar domyślnie z uwagi).
export async function convertRemark(id: string, body: Record<string, unknown>, actor: Actor) {
  const r = await prisma.remark.findUnique({ where: { id } });
  if (!r) throw new PorzadkiError("Uwaga nie istnieje.", 404);
  if (r.proposalId) throw new PorzadkiError("Ta uwaga ma już wniosek.", 409);
  const area = (typeof body.area === "string" ? body.area : r.area) as AreaKey | null;
  if (!area || !(await findArea(area))) throw new PorzadkiError("Wybierz obszar wniosku.");
  const type = typeof body.type === "string" ? body.type : "JAKOSC_DANYCH";
  const firstSentence = r.body.split(/(?<=[.!?])\s|\n/)[0]?.trim() || r.body;
  const title = (typeof body.title === "string" && body.title.trim() ? body.title.trim() : firstSentence).slice(0, 191);
  const parsed = parseProposalInput(
    {
      title,
      area,
      type,
      problem: r.body,
      evidence: r.evidence,
      priority: typeof body.priority === "string" ? body.priority : "MEDIUM",
      clientIds: r.clientId ? [r.clientId] : [],
    },
    false,
  );
  if (!parsed.ok) throw new PorzadkiError(parsed.message);
  const p = await createProposal(parsed.data as ProposalInput, actor);
  await prisma.remark.update({ where: { id }, data: { proposalId: p.id } });
  return p;
}
