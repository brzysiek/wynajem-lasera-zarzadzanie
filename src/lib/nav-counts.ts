import { prisma } from "@/lib/prisma";
import { countLeadWork } from "@/lib/leads/load";
import { loadClientRows } from "@/lib/clients/load";
import { loadUnassignedRentals } from "@/lib/clients/rental-match";
import { countCalendarQueues } from "@/lib/calendar/queues";

// Liczniki w menu bocznym (wniosek 26): Sygnały — moje na dziś (lista „Na
// dziś” + moje zadania przy sygnałach do dziś), Klienci — suma granatowego
// paska „Do zrobienia dziś”, Kalendarz — „Do dopięcia”. Klienci i Kalendarz
// liczone raz na kilka minut dla całego biura (lista klientów jest ciężka).

const TTL = 5 * 60_000;
let shared: { at: number; klienci: number; kalendarz: number } | null = null;

async function sharedCounts(now: Date) {
  if (shared && now.getTime() - shared.at < TTL) return shared;
  const unassigned = await loadUnassignedRentals({ now }).catch(() => []);
  const [rows, kalendarz] = await Promise.all([loadClientRows(now, { unassigned }), countCalendarQueues(now).catch(() => 0)]);
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8).toISOString();
  const afterRental = rows.filter((r) => r.pickupAt).length;
  const stepSoon = rows.filter((r) => r.nextStep?.dueAt && r.nextStep.dueAt < limit).length;
  const check = rows.filter((r) => r.check).length;
  shared = { at: now.getTime(), klienci: afterRental + stepSoon + unassigned.length + check, kalendarz };
  return shared;
}

export async function navCounts(userId: string, now = new Date()): Promise<{ sygnaly: number; klienci: number; kalendarz: number }> {
  const eod = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const [work, signalTasks, s] = await Promise.all([
    countLeadWork(userId, now),
    prisma.task.count({ where: { status: "OPEN", assigneeId: userId, dueDate: { lt: eod }, OR: [{ leadId: { not: null } }, { links: { some: { kind: "LEAD" } } }] } }),
    sharedCounts(now).catch(() => ({ klienci: 0, kalendarz: 0 })),
  ]);
  return { sygnaly: work + signalTasks, klienci: s.klienci, kalendarz: s.kalendarz };
}
