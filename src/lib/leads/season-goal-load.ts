import { prisma } from "@/lib/prisma";
import { loadClientStatusInfo } from "@/lib/clients/load";
import type { Playbook } from "@/lib/leads/playbook";
import { SPRING_LIST_KEY, SPRING_REF_PREFIX, computeSeasonGoal, parseSpringList, seasonBounds, springOutcome, type SeasonGoal } from "@/lib/leads/season-goal";

// Cel sezonu z bazy (wniosek 21): wynajmy w sezonie, wcześniejsze przyjazdy
// klientów i zamrożona lista „wracają z wiosny”.
export async function loadSpringIds(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: SPRING_LIST_KEY } });
  return parseSpringList(row?.value);
}

export async function loadSeasonGoal(season: Playbook["season"]): Promise<SeasonGoal> {
  const { from, to } = seasonBounds(season);
  const [springIds, seasonRows] = await Promise.all([
    loadSpringIds(),
    prisma.rental.findMany({
      where: { eventType: "WYNAJEM", deletedInGoogle: false, clientId: { not: null }, startsAt: { gte: from, lte: to } },
      select: { clientId: true },
      distinct: ["clientId"],
    }),
  ]);
  const clientIds = seasonRows.map((r) => r.clientId as string);
  const [rentals, info, springClients, springLeads] = await Promise.all([
    prisma.rental.findMany({
      where: { clientId: { in: clientIds }, startsAt: { lte: to } },
      select: { clientId: true, startsAt: true, createdAt: true, eventType: true, deletedInGoogle: true, device: { select: { name: true } }, client: { select: { name: true, shortName: true } } },
    }),
    loadClientStatusInfo(clientIds),
    prisma.client.findMany({ where: { id: { in: springIds } }, select: { id: true, name: true, shortName: true } }),
    prisma.lead.findMany({
      where: { clientId: { in: springIds }, archivedAt: null, createdAt: { gte: new Date(from.getTime() - 60 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      select: { id: true, clientId: true, stage: true, lastContactAt: true, sourceRef: true },
    }),
  ]);
  const goal = computeSeasonGoal({
    season,
    springIds,
    rentals: rentals.map((r) => ({
      clientId: r.clientId as string,
      clientName: r.client?.shortName ?? r.client?.name ?? "",
      startsAt: r.startsAt,
      createdAt: r.createdAt,
      eventType: r.eventType,
      deletedInGoogle: r.deletedInGoogle,
      deviceName: r.device.name,
    })),
    priorArrivals: new Map([...info].map(([id, x]) => [id, x.realized])),
  });
  const booked = new Set(goal.wins.map((w) => w.clientId));
  const order = new Map(springIds.map((id, i) => [id, i]));
  const spring = springClients
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((c) => {
      // Sygnał „wraca z wiosny”, a gdy go nie ma — najnowszy sygnał gabinetu.
      const lead = springLeads.find((l) => l.clientId === c.id && l.sourceRef?.startsWith(SPRING_REF_PREFIX)) ?? springLeads.find((l) => l.clientId === c.id) ?? null;
      return {
        clientId: c.id,
        name: c.shortName ?? c.name,
        outcome: springOutcome(booked.has(c.id), lead),
        leadId: lead?.id ?? null,
        bookedAt: goal.wins.find((w) => w.clientId === c.id)?.startsAt ?? null,
      };
    });
  return { ...goal, spring };
}
