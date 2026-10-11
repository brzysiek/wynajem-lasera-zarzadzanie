import { prisma } from "@/lib/prisma";

// Ostatnia aktywność robocza na osi czasu sygnału (rozmowa, nieodebrane, SMS,
// mail, notatka, zmiana etapu) — składnik „ostatniej pracy” (lastWorkAt) w regule
// gnicia (funnel.ts, rotInfo). Wpisy SYSTEM (np. „termin: a → b”, propozycja
// agenta) nie liczą się; zmianę kroku przez człowieka dolicza combineLastWork
// (set-source.ts) ze znacznika stepSourceAt.
export const WORK_ACTIVITY_TYPES = ["CALL", "CALL_NO_ANSWER", "SMS", "EMAIL", "NOTE", "STAGE_CHANGE"] as const;

export async function loadLastWorkActivity(leadIds: string[]): Promise<Map<string, Date>> {
  if (!leadIds.length) return new Map();
  const rows = await prisma.leadActivity.groupBy({
    by: ["leadId"],
    where: { leadId: { in: leadIds }, type: { in: [...WORK_ACTIVITY_TYPES] } },
    _max: { createdAt: true },
  });
  return new Map(rows.filter((r) => r.leadId && r._max.createdAt).map((r) => [r.leadId as string, r._max.createdAt as Date]));
}
