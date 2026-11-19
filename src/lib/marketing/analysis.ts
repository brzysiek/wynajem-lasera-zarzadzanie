import { prisma } from "@/lib/prisma";
import { recordChanges } from "@/lib/changelog/record";
import { toLogValue } from "@/lib/changelog/diff";
import { campaignFromCostName, normalizeKeyword } from "./source";
import { nextStatus, type Action, type Rating, type ReportInput, type Status } from "./analysis-rules";

// Wniosek 54, etap 1c: zakładka Analiza i oceny fraz — zapis w bazie. Każda decyzja,
// wdrożenie, raport i ocena frazy trafia do dziennika zmian panelu (obiekt „marketing”).

export type Actor = { userId: string; name: string };
const day = (d: Date) => d.toISOString().slice(0, 10);

export type ProposalDto = {
  id: string;
  reportId: string;
  area: string;
  title: string;
  reasoning: string;
  status: Status;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
  implementedAt: string | null;
  implementedBy: string | null;
  implementedNote: string | null;
};

const dto = (p: {
  id: string; reportId: string; area: string; title: string; reasoning: string; status: string; decidedByName: string | null; decidedAt: Date | null; comment: string | null;
  implementedAt: Date | null; implementedBy: string | null; implementedNote: string | null;
}): ProposalDto => ({
  id: p.id,
  reportId: p.reportId,
  area: p.area,
  title: p.title,
  reasoning: p.reasoning,
  status: p.status as Status,
  decidedByName: p.decidedByName,
  decidedAt: p.decidedAt?.toISOString() ?? null,
  comment: p.comment,
  implementedAt: p.implementedAt?.toISOString() ?? null,
  implementedBy: p.implementedBy,
  implementedNote: p.implementedNote,
});

export async function saveReport(input: ReportInput, actor: Actor): Promise<{ id: string; proposalIds: string[] }> {
  return prisma.$transaction(async (tx) => {
    const r = await tx.marketingReport.create({
      data: { periodFrom: new Date(`${input.periodFrom}T00:00:00Z`), periodTo: new Date(`${input.periodTo}T00:00:00Z`), title: input.title, conclusions: input.conclusions, contentMd: input.contentMd, author: actor.name },
    });
    const proposalIds: string[] = [];
    for (const p of input.proposals) {
      const row = await tx.marketingProposal.create({ data: { reportId: r.id, area: p.area, title: p.title, reasoning: p.reasoning } });
      proposalIds.push(row.id);
    }
    await recordChanges(tx, { userId: actor.userId }, [
      { entity: "MARKETING", entityId: r.id, operation: "CREATE", field: "raport", before: "null", after: toLogValue(`${input.title} (${input.periodFrom} – ${input.periodTo}), propozycji: ${proposalIds.length}`) },
    ]);
    return { id: r.id, proposalIds };
  });
}

export async function listReports() {
  const rows = await prisma.marketingReport.findMany({ orderBy: [{ periodTo: "desc" }, { createdAt: "desc" }], include: { proposals: { select: { status: true } } } });
  return rows.map((r) => ({
    id: r.id,
    periodFrom: day(r.periodFrom),
    periodTo: day(r.periodTo),
    title: r.title,
    author: r.author,
    createdAt: r.createdAt.toISOString(),
    counts: {
      proposals: r.proposals.length,
      implemented: r.proposals.filter((p) => p.status === "wdrozona").length,
      rejected: r.proposals.filter((p) => p.status === "odrzucona").length,
      waiting: r.proposals.filter((p) => p.status === "czeka").length,
    },
  }));
}

export async function getReport(id: string) {
  const r = await prisma.marketingReport.findUnique({ where: { id }, include: { proposals: { orderBy: { createdAt: "asc" } } } });
  if (!r) return null;
  const concl = Array.isArray(r.conclusions) ? (r.conclusions as { tytul: string; opis: string }[]) : [];
  return { id: r.id, periodFrom: day(r.periodFrom), periodTo: day(r.periodTo), title: r.title, author: r.author, createdAt: r.createdAt.toISOString(), conclusions: concl, contentMd: r.contentMd, proposals: r.proposals.map(dto) };
}

export const waitingProposals = () => prisma.marketingProposal.count({ where: { status: "czeka" } });

export async function listMarketingProposals(status?: Status | null): Promise<(ProposalDto & { periodFrom: string; periodTo: string; reportTitle: string })[]> {
  const rows = await prisma.marketingProposal.findMany({ where: status ? { status } : undefined, orderBy: { createdAt: "desc" }, include: { report: { select: { periodFrom: true, periodTo: true, title: true } } } });
  return rows.map((p) => ({ ...dto(p), periodFrom: day(p.report.periodFrom), periodTo: day(p.report.periodTo), reportTitle: p.report.title }));
}

export type ActionResult = { ok: true; proposal: ProposalDto } | { ok: false; status: number; message: string };

// Decyzje administratora: accept / reject / undo (do wdrożenia). Wdrożenie: implement.
export async function actOnProposal(id: string, action: Action, actor: Actor, opts: { comment?: string | null; note?: string | null } = {}): Promise<ActionResult> {
  const cur = await prisma.marketingProposal.findUnique({ where: { id } });
  if (!cur) return { ok: false, status: 404, message: "Nie znaleziono propozycji." };
  const next = nextStatus(cur.status as Status, action);
  if (!next.ok) return { ok: false, status: 409, message: next.message };
  if (action === "implement" && !opts.note?.trim()) return { ok: false, status: 400, message: "Podaj notatkę wdrożenia — co zostało zrobione." };
  const now = new Date();
  const data =
    action === "accept" || action === "reject"
      ? { status: next.value, decidedByName: actor.name, decidedAt: now, comment: opts.comment?.trim() || null }
      : action === "undo"
        ? { status: next.value, decidedByName: null, decidedAt: null, comment: null }
        : { status: next.value, implementedAt: now, implementedBy: actor.name, implementedNote: opts.note!.trim() };
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.marketingProposal.update({ where: { id }, data });
    await recordChanges(tx, { userId: actor.userId }, [
      {
        entity: "MARKETING",
        entityId: id,
        operation: "STATUS_CHANGE",
        field: `propozycja: ${cur.title.slice(0, 40)}`,
        before: toLogValue(cur.status),
        after: toLogValue(`${next.value}${opts.comment?.trim() ? ` — ${opts.comment.trim()}` : ""}${action === "implement" ? ` — ${opts.note!.trim()}` : ""}`),
      },
    ]);
    return updated;
  });
  return { ok: true, proposal: dto(row) };
}

// --------------------------------------------------------------- oceny fraz

export type RatingDto = { rating: Rating; reason: string | null; ratedByName: string; ratedAt: string };

export const ratingKey = (campaignKey: string, keyword: string) => `${campaignKey}\u0001${keyword}`;

export async function loadRatings(): Promise<Map<string, RatingDto>> {
  const rows = await prisma.marketingKeywordRating.findMany();
  return new Map(rows.map((r) => [ratingKey(r.campaignKey, r.keyword), { rating: r.rating as Rating, reason: r.reason, ratedByName: r.ratedByName, ratedAt: r.ratedAt.toISOString() }]));
}

// Kampania z nazwy, sluga albo numeru Google (jak w raporcie kosztów i znacznikach sygnałów).
export function resolveCampaign(value: string): { key: string; label: string } {
  const v = value.trim();
  return /^\d{6,}$/.test(v) ? campaignFromCostName("", v) : campaignFromCostName(v);
}

export async function setRating(input: { campaign: string; phrase: string; rating: Rating | "brak"; reason: string | null }, actor: Actor): Promise<{ campaignKey: string; keyword: string; rating: string }> {
  const camp = resolveCampaign(input.campaign);
  const keyword = normalizeKeyword(input.phrase).slice(0, 150);
  if (!keyword) throw new Error("Pusta fraza.");
  const where = { campaignKey_keyword: { campaignKey: camp.key, keyword } };
  const before = await prisma.marketingKeywordRating.findUnique({ where });
  if (input.rating === "brak") {
    if (before) await prisma.marketingKeywordRating.delete({ where });
  } else {
    await prisma.marketingKeywordRating.upsert({
      where,
      create: { campaignKey: camp.key, campaignName: camp.label, keyword, keywordText: input.phrase.slice(0, 191), rating: input.rating, reason: input.reason, ratedByName: actor.name },
      update: { campaignName: camp.label, rating: input.rating, reason: input.reason, ratedByName: actor.name, ratedAt: new Date() },
    });
  }
  await recordChanges(prisma, { userId: actor.userId }, [
    {
      entity: "MARKETING",
      entityId: `${camp.key}:${keyword}`.slice(0, 191),
      operation: "FIELD_CHANGE",
      field: "ocena frazy",
      before: toLogValue(before?.rating ?? null),
      after: toLogValue(input.rating === "brak" ? null : `${input.rating}${input.reason ? ` — ${input.reason}` : ""}`),
    },
  ]);
  return { campaignKey: camp.key, keyword, rating: input.rating };
}
