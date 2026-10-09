import { prisma } from "@/lib/prisma";
import { FUNNEL_FROM, NEXT_STEP_LABEL, type NextStepType } from "@/lib/leads/funnel";
import { DRAFT_ACTIVE } from "@/lib/leads/mail-draft-rules";
import { STAGE_LABEL } from "@/lib/leads/labels";
import { countNewEntries, isRequestPending, rankWork, suggestionReasons } from "@/lib/leads/suggestion-rules";
import type { LeadStageKey } from "@/lib/leads/parse-deal";

// Praca agenta w zaplanowanych przebiegach (wniosek 47): LEKKIE listy sygnałów,
// które czekają na sugestię albo na propozycję odpowiedzi — zamiast pełnych
// wierszy listy (oszczędza kontekst agenta). Kolejność: krok na dziś lub po
// terminie → prośby o aktualizację → reszta od najnowszej aktywności.

const OPEN: LeadStageKey[] = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"];
const endOfToday = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

export type WorkRow = {
  id: string;
  tytul: string;
  klient: string | null;
  email: string | null;
  etap: string;
  krok: string | null;
  termin_kroku: string | null;
  powody: string[];
  nowe_wpisy: number;
  sugestia_z: string | null;
  ostatnia_wiadomosc_od_klientki: string | null;
};

const LEAD_SELECT = {
  id: true,
  title: true,
  stage: true,
  clientId: true,
  contactName: true,
  contactEmail: true,
  nextActionAt: true,
  nextStepType: true,
  createdAt: true,
  client: { select: { name: true, shortName: true, contacts: { where: { isPrimary: true }, take: 1, select: { email: true } } } },
} as const;

type LeadRowDb = {
  id: string;
  title: string;
  stage: string;
  clientId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  nextActionAt: Date | null;
  nextStepType: string | null;
  createdAt: Date;
  client: { name: string; shortName: string | null; contacts: { email: string | null }[] } | null;
};

function base(l: LeadRowDb): Omit<WorkRow, "powody" | "nowe_wpisy" | "sugestia_z" | "ostatnia_wiadomosc_od_klientki"> {
  return {
    id: l.id,
    tytul: l.title,
    klient: l.client?.shortName ?? l.client?.name ?? l.contactName ?? null,
    email: l.contactEmail ?? l.client?.contacts[0]?.email ?? null,
    etap: STAGE_LABEL[l.stage as LeadStageKey] ?? l.stage,
    krok: l.nextStepType ? (NEXT_STEP_LABEL[l.nextStepType as NextStepType] ?? l.nextStepType) : null,
    termin_kroku: l.nextActionAt?.toISOString() ?? null,
  };
}

// Najnowsza aktywność na sygnał (wpis osi czasu albo mail klientki) — do kolejności.
async function lastEntries(leads: LeadRowDb[]): Promise<Map<string, number>> {
  const ids = leads.map((l) => l.id);
  const clientIds = [...new Set(leads.map((l) => l.clientId).filter((x): x is string => !!x))];
  const [acts, mails] = await Promise.all([
    ids.length ? prisma.leadActivity.groupBy({ by: ["leadId"], where: { leadId: { in: ids } }, _max: { createdAt: true } }) : [],
    clientIds.length ? prisma.emailMessage.groupBy({ by: ["clientId"], where: { clientId: { in: clientIds }, hiddenReason: null }, _max: { sentAt: true } }) : [],
  ]);
  const mailByClient = new Map(mails.map((m) => [m.clientId as string, m._max.sentAt?.getTime() ?? 0]));
  const out = new Map<string, number>();
  for (const l of leads) {
    const a = acts.find((x) => x.leadId === l.id)?._max.createdAt?.getTime() ?? 0;
    out.set(l.id, Math.max(a, l.clientId ? (mailByClient.get(l.clientId) ?? 0) : 0, l.createdAt.getTime()));
  }
  return out;
}

// wymaga_sugestii: brak sugestii, prośba o aktualizację albo nowe wpisy od ostatniej.
export async function listSuggestionWork(limit: number, now = new Date()): Promise<{ rows: WorkRow[]; total: number }> {
  const leads = await prisma.lead.findMany({
    where: { archivedAt: null, stage: { in: OPEN }, createdAt: { gte: FUNNEL_FROM } },
    select: { ...LEAD_SELECT, suggestion: { select: { generatedAt: true, coveredUntil: true, requestedAt: true } } },
    take: 800,
  });
  const withS = leads.filter((l) => l.suggestion);
  const minCovered = withS.length ? new Date(Math.min(...withS.map((l) => l.suggestion!.coveredUntil.getTime()))) : null;
  const clientIds = [...new Set(withS.map((l) => l.clientId).filter((x): x is string => !!x))];
  const [acts, mails, last] = await Promise.all([
    minCovered && withS.length ? prisma.leadActivity.findMany({ where: { leadId: { in: withS.map((l) => l.id) }, createdAt: { gt: minCovered } }, select: { leadId: true, type: true, body: true, createdAt: true } }) : [],
    minCovered && clientIds.length ? prisma.emailMessage.findMany({ where: { clientId: { in: clientIds }, hiddenReason: null, sentAt: { gt: minCovered } }, select: { clientId: true, sentAt: true } }) : [],
    lastEntries(leads),
  ]);
  const eod = endOfToday(now);
  const items = leads.flatMap((l) => {
    const s = l.suggestion;
    const newEntries = s
      ? countNewEntries(s.coveredUntil, [
          ...acts.filter((a) => a.leadId === l.id).map((a) => ({ at: a.createdAt, type: a.type, body: a.body })),
          ...mails.filter((m) => m.clientId === l.clientId).map((m) => ({ at: m.sentAt, type: "EMAIL" })),
        ])
      : 0;
    const requestPending = s ? isRequestPending(s.requestedAt, s.generatedAt) : false;
    const powody = suggestionReasons({ exists: !!s, requestPending, newEntries });
    if (!powody.length) return [];
    return [
      {
        row: { ...base(l), powody, nowe_wpisy: newEntries, sugestia_z: s?.generatedAt.toISOString() ?? null, ostatnia_wiadomosc_od_klientki: null } as WorkRow,
        stepDue: !!l.nextActionAt && l.nextActionAt <= eod,
        requestPending,
        stepAt: l.nextActionAt?.getTime() ?? null,
        lastEntryAt: last.get(l.id) ?? 0,
      },
    ];
  });
  const ranked = rankWork(items);
  return { rows: ranked.slice(0, limit).map((x) => x.row), total: ranked.length };
}

// wymaga_odpowiedzi: otwarty sygnał z adresem e-mail i BEZ aktywnego szkicu, gdy
// krok jest na dziś / po terminie / brak kroku albo klientka napisała, a my nie odpowiedzieliśmy.
export async function listReplyWork(limit: number, now = new Date()): Promise<{ rows: WorkRow[]; total: number }> {
  const leads = await prisma.lead.findMany({
    where: {
      archivedAt: null,
      stage: { in: ["SYGNAL", "WYWIAD", "OFERTA"] },
      createdAt: { gte: FUNNEL_FROM },
      emailDrafts: { none: { status: { in: [...DRAFT_ACTIVE] } } },
      OR: [{ contactEmail: { not: null } }, { client: { contacts: { some: { email: { not: null } } } } }],
    },
    select: LEAD_SELECT,
    take: 800,
  });
  const clientIds = [...new Set(leads.map((l) => l.clientId).filter((x): x is string => !!x))];
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const [inbound, outbound, last] = await Promise.all([
    clientIds.length ? prisma.emailMessage.groupBy({ by: ["clientId"], where: { clientId: { in: clientIds }, direction: "IN", hiddenReason: null, sentAt: { gte: since } }, _max: { sentAt: true } }) : [],
    clientIds.length ? prisma.emailMessage.groupBy({ by: ["clientId"], where: { clientId: { in: clientIds }, direction: "OUT", sentAt: { gte: since } }, _max: { sentAt: true } }) : [],
    lastEntries(leads),
  ]);
  const inAt = new Map(inbound.map((m) => [m.clientId as string, m._max.sentAt as Date]));
  const outAt = new Map(outbound.map((m) => [m.clientId as string, m._max.sentAt as Date]));
  const eod = endOfToday(now);
  const items = leads.flatMap((l) => {
    const powody: string[] = [];
    const stepDue = !!l.nextActionAt && l.nextActionAt <= eod;
    if (stepDue) powody.push(l.nextActionAt! < new Date(now.getFullYear(), now.getMonth(), now.getDate()) ? "krok po terminie" : "krok na dziś");
    if (!l.nextActionAt) powody.push("brak kroku");
    const lastIn = l.clientId ? inAt.get(l.clientId) : undefined;
    const lastOut = l.clientId ? outAt.get(l.clientId) : undefined;
    const unanswered = !!lastIn && (!lastOut || lastIn > lastOut);
    if (unanswered) powody.push("mail od klientki bez odpowiedzi");
    if (!powody.length) return [];
    return [
      {
        row: { ...base(l), powody, nowe_wpisy: 0, sugestia_z: null, ostatnia_wiadomosc_od_klientki: lastIn?.toISOString() ?? null } as WorkRow,
        stepDue,
        requestPending: unanswered,
        stepAt: l.nextActionAt?.getTime() ?? null,
        lastEntryAt: last.get(l.id) ?? 0,
      },
    ];
  });
  const ranked = rankWork(items);
  return { rows: ranked.slice(0, limit).map((x) => x.row), total: ranked.length };
}
