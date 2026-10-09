import { prisma } from "@/lib/prisma";
import { STAGE_LABEL, TYPE_LABEL } from "@/lib/leads/labels";
import type { LeadStageKey, LeadTypeKey } from "@/lib/leads/parse-deal";
import { stepForStage } from "@/lib/leads/funnel";
import { qualifyClient } from "@/lib/clients/qualify";
import { stageSet, stepSet } from "@/lib/leads/set-source";

// Lejek v2, etap V3 — reguły przy nowym zapytaniu (import z HubSpota i
// sygnał z panelu), lejek-v2 3.3:
// - jeden otwarty sygnał na klientkę i potrzebę: ponowne zapytanie (import w
//   ciągu 10 min albo to samo / nieokreślone urządzenie) = aktywność w
//   istniejącym sygnale, a nowy rekord trafia do archiwum jako duplikat;
// - stała klientka (wynajem w ostatnich 12 mies.) nie przechodzi przez lejek:
//   od razu „W kontakcie” z krokiem „umówić termin” na dziś, poza konwersją.

const LIVE = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "ODLOZONE"] as const;
export const DUPLICATE_WINDOW_MIN = 10;

export type Intake = { duplicateOf: { id: string; stage: (typeof LIVE)[number] } | null; returning: boolean };

export async function intakeRules(clientId: string | null, createdAt: Date, devices: string[]): Promise<Intake> {
  if (!clientId) return { duplicateOf: null, returning: false };
  const [open, rentals] = await Promise.all([
    prisma.lead.findMany({
      where: { clientId, archivedAt: null, stage: { in: [...LIVE] }, createdAt: { lte: createdAt } },
      orderBy: { createdAt: "desc" },
      select: { id: true, stage: true, createdAt: true, deviceInterest: true },
    }),
    prisma.rental.count({ where: { clientId, deletedInGoogle: false, startsAt: { gte: new Date(createdAt.getTime() - 365 * 86_400_000), lte: createdAt } } }),
  ]);
  const dup = open.find((l) => {
    if (Math.abs(createdAt.getTime() - l.createdAt.getTime()) <= DUPLICATE_WINDOW_MIN * 60_000) return true;
    const theirs = Array.isArray(l.deviceInterest) ? (l.deviceInterest as unknown[]).filter((x): x is string => typeof x === "string") : [];
    return devices.length === 0 || theirs.length === 0 || devices.some((d) => theirs.includes(d));
  });
  return { duplicateOf: dup ? { id: dup.id, stage: dup.stage as (typeof LIVE)[number] } : null, returning: rentals > 0 };
}

// Ponowne zapytanie jako aktywność w istniejącym sygnale; odłożony wraca do
// „W kontakcie” z krokiem na dziś, pozostałe dostają krok najpóźniej dziś.
// Formularz WWW (wniosek 39) podaje też szczegóły (sprzęt, termin, dni,
// miejscowość): wpis ma pełną nową treść, a puste pola sygnału się uzupełniają
// (sprzęt — suma; termin, dni i miejscowość tylko gdy ich brakuje).
export type RepeatDetails = { devices?: string[]; requestedFrom?: Date | null; requestedDays?: number | null; location?: string | null; lines?: string[] };

export async function mergeRepeatInquiry(
  target: { id: string; stage: string },
  info: { type: LeadTypeKey; createdAt: Date; message: string | null; details?: RepeatDetails },
  now = new Date(),
) {
  const lead = await prisma.lead.findUnique({
    where: { id: target.id },
    select: { clientId: true, nextActionAt: true, stage: true, deviceInterest: true, requestedFrom: true, requestedDays: true, location: true },
  });
  if (!lead) return;
  const back = lead.stage === "ODLOZONE";
  const pull = back || !lead.nextActionAt || lead.nextActionAt > now;
  const d = info.details;
  const have = Array.isArray(lead.deviceInterest) ? (lead.deviceInterest as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const devices = d?.devices?.length ? [...new Set([...have, ...d.devices])] : null;
  const fill = {
    ...(devices && devices.length !== have.length ? { deviceInterest: devices } : {}),
    ...(!lead.requestedFrom && d?.requestedFrom ? { requestedFrom: d.requestedFrom } : {}),
    ...(lead.requestedDays == null && d?.requestedDays != null ? { requestedDays: d.requestedDays } : {}),
    ...(!lead.location && d?.location ? { location: d.location } : {}),
  };
  const lines = d?.lines?.length ? ` — ${d.lines.join(" · ")}` : "";
  await prisma.$transaction([
    prisma.lead.update({
      where: { id: target.id },
      data: {
        ...fill,
        ...(back ? { stage: "WYWIAD", stageChangedAt: now, returnAt: null, ...stageSet("AUTO_REPEAT", null, now) } : {}),
        ...(pull ? { nextActionAt: now, nextStepType: "DOPYTAC", nextStepNote: "ponowne zapytanie — oddzwonić", ...stepSet("AUTO_REPEAT", null, now) } : {}),
      },
    }),
    prisma.leadActivity.create({
      data: {
        leadId: target.id,
        clientId: lead.clientId,
        type: back ? "STAGE_CHANGE" : "SYSTEM",
        body: `Ponowne zapytanie (${TYPE_LABEL[info.type]}, ${info.createdAt.toLocaleDateString("pl-PL")})${lines}${info.message ? `: ${info.message.slice(0, d ? 1500 : 300)}` : ""}${back ? ` · ${STAGE_LABEL.ODLOZONE} → ${STAGE_LABEL.WYWIAD}` : ""}`,
      },
    }),
  ]);
}

// Przegląd 29.09, pkt 5: po archiwizacji duplikatu (powód DUPLIKAT) otwarty
// sygnał, który zostaje, przejmuje wyższy etap, pierwszy / ostatni kontakt,
// próby i najbliższy krok z archiwizowanego — archiwizacja nie cofa lejka.
const RANK: Record<string, number> = { SYGNAL: 0, WYWIAD: 1, ODLOZONE: 1, OFERTA: 2, REZERWACJA: 3 };

export async function takeOverFromDuplicates(archivedIds: string[]): Promise<number> {
  let merged = 0;
  const archived = await prisma.lead.findMany({
    where: { id: { in: archivedIds }, clientId: { not: null }, stage: { in: [...LIVE] } },
    select: { id: true, clientId: true, stage: true, stageChangedAt: true, firstContactAt: true, lastContactAt: true, attempts: true, followUpNo: true, nextActionAt: true, nextStepType: true, nextStepNote: true, returnAt: true, postponeReason: true, rentalId: true, title: true },
  });
  for (const a of archived) {
    const s = await prisma.lead.findFirst({
      where: { clientId: a.clientId, archivedAt: null, stage: { in: [...LIVE] }, id: { not: a.id } },
      orderBy: { createdAt: "desc" },
      select: { id: true, stage: true, firstContactAt: true, lastContactAt: true, attempts: true, followUpNo: true, nextActionAt: true, nextStepType: true, nextStepNote: true, rentalId: true },
    });
    if (!s) continue;
    const higher = RANK[a.stage] > RANK[s.stage];
    const stage = higher ? a.stage : s.stage;
    // Najbliższy krok: wcześniejszy z dwóch (albo jedyny), dopasowany do etapu.
    const takeStep = a.nextActionAt && (!s.nextActionAt || a.nextActionAt < s.nextActionAt);
    const step = takeStep ? { at: a.nextActionAt, type: a.nextStepType, note: a.nextStepNote } : { at: s.nextActionAt, type: s.nextStepType, note: s.nextStepNote };
    const min = (x: Date | null, y: Date | null) => (x && y ? (x < y ? x : y) : (x ?? y));
    const max = (x: Date | null, y: Date | null) => (x && y ? (x > y ? x : y) : (x ?? y));
    const moveRental = !s.rentalId && a.rentalId;
    const changed = higher || takeStep || (!s.firstContactAt && a.firstContactAt) || moveRental;
    if (!changed) continue;
    await prisma.$transaction([
      ...(moveRental ? [prisma.lead.update({ where: { id: a.id }, data: { rentalId: null } })] : []),
      prisma.lead.update({
        where: { id: s.id },
        data: {
          // Data wejścia w etap (np. data oferty) z duplikatu, nie dzień scalenia.
          ...(higher ? { stage, stageChangedAt: a.stageChangedAt, ...stageSet("AUTO_TAKEOVER"), ...(a.stage === "ODLOZONE" ? { returnAt: a.returnAt, postponeReason: a.postponeReason } : {}) } : {}),
          firstContactAt: min(s.firstContactAt, a.firstContactAt),
          lastContactAt: max(s.lastContactAt, a.lastContactAt),
          attempts: Math.max(s.attempts, a.attempts),
          followUpNo: Math.max(s.followUpNo, a.followUpNo),
          nextActionAt: step.at,
          nextStepType: stepForStage(stage as LeadStageKey, step.type),
          nextStepNote: step.note,
          ...(takeStep ? stepSet("AUTO_TAKEOVER") : {}),
          ...(moveRental ? { rentalId: a.rentalId } : {}),
        },
      }),
      prisma.leadActivity.create({
        data: {
          leadId: s.id,
          clientId: a.clientId,
          type: higher ? "STAGE_CHANGE" : "SYSTEM",
          body: `Przejęto z duplikatu „${a.title}”${higher ? `: ${STAGE_LABEL[s.stage as LeadStageKey]} → ${STAGE_LABEL[stage as LeadStageKey]}` : ""}${takeStep ? " · najbliższy krok z duplikatu" : ""}`,
        },
      }),
    ]);
    // Przejęty etap dalej niż „Nowe” z kontaktem = była interakcja → Potencjalny.
    if (stage !== "SYGNAL" && min(s.firstContactAt, a.firstContactAt)) await qualifyClient(a.clientId, "MANUAL");
    merged++;
  }
  return merged;
}
