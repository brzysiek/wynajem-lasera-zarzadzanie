import { prisma } from "@/lib/prisma";
import { STAGE_LABEL, TYPE_LABEL } from "@/lib/leads/labels";
import type { LeadTypeKey } from "@/lib/leads/parse-deal";

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
export async function mergeRepeatInquiry(target: { id: string; stage: string }, info: { type: LeadTypeKey; createdAt: Date; message: string | null }, now = new Date()) {
  const lead = await prisma.lead.findUnique({ where: { id: target.id }, select: { clientId: true, nextActionAt: true, stage: true } });
  if (!lead) return;
  const back = lead.stage === "ODLOZONE";
  const pull = back || !lead.nextActionAt || lead.nextActionAt > now;
  await prisma.$transaction([
    prisma.lead.update({
      where: { id: target.id },
      data: {
        ...(back ? { stage: "WYWIAD", stageChangedAt: now, returnAt: null } : {}),
        ...(pull ? { nextActionAt: now, nextStepType: "DOPYTAC", nextStepNote: "ponowne zapytanie — oddzwonić" } : {}),
      },
    }),
    prisma.leadActivity.create({
      data: {
        leadId: target.id,
        clientId: lead.clientId,
        type: back ? "STAGE_CHANGE" : "SYSTEM",
        body: `Ponowne zapytanie (${TYPE_LABEL[info.type]}, ${info.createdAt.toLocaleDateString("pl-PL")})${info.message ? `: ${info.message.slice(0, 300)}` : ""}${back ? ` · ${STAGE_LABEL.ODLOZONE} → ${STAGE_LABEL.WYWIAD}` : ""}`,
      },
    }),
  ]);
}
