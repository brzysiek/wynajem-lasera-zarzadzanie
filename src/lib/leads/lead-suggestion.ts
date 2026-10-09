import { prisma } from "@/lib/prisma";
import { recordChanges } from "@/lib/changelog/record";
import { SUGGESTION_MAX, countNewEntries, isDraftNoise, isRequestPending, validateSuggestionText } from "@/lib/leads/suggestion-rules";

// Sugestia Klaudiusza (wniosek 47, część 2): zapisuje ją agent (MCP
// sugestia_zapisz) w zaplanowanych przebiegach; panel niczego nie generuje i nie
// woła żadnego API modelu. Treść sugestii nie trafia do dziennika zmian — tylko
// fakt zapisu.

export class SuggestionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type SuggestionDto = {
  text: string;
  basis: string | null;
  generatedAt: string;
  authorName: string | null;
  // „Poproś o aktualizację” czeka na następny przebieg.
  requestPending: boolean;
  // Od sugestii doszły nowe wpisy osi czasu — karta ją przygasza.
  newEntries: number;
  stale: boolean;
  // Kiedy agent ostatnio cokolwiek zapisał (jakikolwiek sygnał) — widać, czy przebiegi chodzą.
  lastRunAt: string | null;
};

const BASIS_MAX = 500;

// Najnowszy wpis osi czasu sygnału: jego wpisy (bez pracy przy szkicu maila) i
// maile klientki. Brak wpisów → data założenia sygnału.
async function latestTimelineAt(leadId: string, clientId: string | null, createdAt: Date): Promise<Date> {
  const [acts, mail] = await Promise.all([
    prisma.leadActivity.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, take: 30, select: { type: true, body: true, createdAt: true } }),
    clientId ? prisma.emailMessage.findFirst({ where: { clientId, hiddenReason: null }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }) : null,
  ]);
  const last = acts.find((a) => !isDraftNoise(a))?.createdAt ?? null;
  return [last, mail?.sentAt ?? null, createdAt].filter((d): d is Date => !!d).reduce((a, b) => (a > b ? a : b));
}

export async function saveSuggestion(leadId: string, agentUserId: string, text: string, basis: string | null): Promise<void> {
  const err = validateSuggestionText(text);
  if (err) throw new SuggestionError(err);
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, clientId: true, createdAt: true, suggestion: { select: { id: true } } } });
  if (!lead) throw new SuggestionError("Sygnał nie istnieje.", 404);
  const data = {
    text: text.trim(),
    basis: basis?.trim() ? basis.trim().slice(0, BASIS_MAX) : null,
    authorId: agentUserId,
    generatedAt: new Date(),
    coveredUntil: await latestTimelineAt(leadId, lead.clientId, lead.createdAt),
    requestedAt: null,
  };
  await prisma.leadSuggestion.upsert({ where: { leadId }, create: { leadId, ...data }, update: data });
  await recordChanges(prisma, { userId: agentUserId }, [{ entity: "LEAD", entityId: leadId, clientId: lead.clientId, operation: lead.suggestion ? "FIELD_CHANGE" : "CREATE", field: "sugestia", after: "zapisana" }]);
}

// „Poproś o aktualizację” (ADMIN/STAFF): oznacza sygnał dla następnego przebiegu.
export async function requestSuggestionUpdate(leadId: string): Promise<void> {
  const s = await prisma.leadSuggestion.findUnique({ where: { leadId }, select: { id: true } });
  if (!s) throw new SuggestionError("Ten sygnał nie ma jeszcze sugestii.", 404);
  await prisma.leadSuggestion.update({ where: { leadId }, data: { requestedAt: new Date() } });
}

export async function loadSuggestion(leadId: string, clientId: string | null): Promise<SuggestionDto | null> {
  const s = await prisma.leadSuggestion.findUnique({ where: { leadId } });
  if (!s) return null;
  const [acts, mails, author, last] = await Promise.all([
    prisma.leadActivity.findMany({ where: { leadId, createdAt: { gt: s.coveredUntil } }, select: { type: true, body: true, createdAt: true } }),
    clientId ? prisma.emailMessage.findMany({ where: { clientId, hiddenReason: null, sentAt: { gt: s.coveredUntil } }, select: { sentAt: true } }) : [],
    s.authorId ? prisma.user.findUnique({ where: { id: s.authorId }, select: { name: true } }) : null,
    prisma.leadSuggestion.aggregate({ _max: { generatedAt: true } }),
  ]);
  const newEntries = countNewEntries(s.coveredUntil, [...acts.map((a) => ({ at: a.createdAt, type: a.type, body: a.body })), ...mails.map((m) => ({ at: m.sentAt, type: "EMAIL" }))]);
  return {
    text: s.text,
    basis: s.basis,
    generatedAt: s.generatedAt.toISOString(),
    authorName: author?.name ?? null,
    requestPending: isRequestPending(s.requestedAt, s.generatedAt),
    newEntries,
    stale: newEntries > 0,
    lastRunAt: last._max.generatedAt?.toISOString() ?? null,
  };
}

export { SUGGESTION_MAX };
