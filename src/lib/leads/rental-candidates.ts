import { prisma } from "@/lib/prisma";
import { nameTokens, parseCandidateQuery } from "@/lib/leads/rental-candidate-rules";

// „Powiąż z wynajmem” (wniosek 18, uwaga b): od razu lista kandydatów —
// przyszłe i niedawne wynajmy tego klienta, wynajmy z podobną nazwą i w
// pobliżu zgłoszonego terminu; pod listą wyszukiwarka po dacie i nazwie.
// Wynajem powiązany z innym sygnałem jest na liście, ale nie do wybrania.

export type RentalCandidate = {
  id: string;
  startsAt: string;
  deviceName: string;
  title: string;
  clientName: string | null;
  totalNet: number | null;
  sameClient: boolean;
  linkedLeadTitle: string | null;
};

const DAY = 86_400_000;

const SELECT = {
  id: true,
  startsAt: true,
  title: true,
  clientId: true,
  device: { select: { name: true } },
  client: { select: { name: true, shortName: true } },
  finance: { select: { totalNet: true } },
  lead: { select: { id: true, title: true } },
} as const;

export async function loadRentalCandidates(leadId: string, q = "", now = new Date()): Promise<RentalCandidate[]> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { clientId: true, requestedFrom: true, contactName: true, client: { select: { name: true, shortName: true } } },
  });
  if (!lead) return [];
  const base = { deletedInGoogle: false, eventType: "WYNAJEM" as const };
  const query = parseCandidateQuery(q, now);
  let rows;
  if (query.date) {
    rows = await prisma.rental.findMany({
      where: { ...base, startsAt: { gte: new Date(query.date.getTime() - 3 * DAY), lte: new Date(query.date.getTime() + 4 * DAY) } },
      orderBy: { startsAt: "asc" },
      take: 30,
      select: SELECT,
    });
  } else if (query.text) {
    rows = await prisma.rental.findMany({
      where: { ...base, startsAt: { gte: new Date(now.getTime() - 180 * DAY) }, OR: [{ title: { contains: query.text } }, { client: { name: { contains: query.text } } }, { client: { shortName: { contains: query.text } } }] },
      orderBy: { startsAt: "asc" },
      take: 30,
      select: SELECT,
    });
  } else {
    const since = new Date(now.getTime() - 45 * DAY);
    const tokens = nameTokens(lead.client?.shortName, lead.client?.name, lead.contactName);
    rows = await prisma.rental.findMany({
      where: {
        ...base,
        OR: [
          ...(lead.clientId ? [{ clientId: lead.clientId, startsAt: { gte: since } }] : []),
          ...(lead.requestedFrom ? [{ startsAt: { gte: new Date(lead.requestedFrom.getTime() - 14 * DAY), lte: new Date(lead.requestedFrom.getTime() + 14 * DAY) }, lead: null }] : []),
          ...tokens.map((t) => ({ title: { contains: t }, startsAt: { gte: since } })),
        ],
      },
      orderBy: { startsAt: "asc" },
      take: 40,
      select: SELECT,
    });
  }
  const around = (lead.requestedFrom ?? now).getTime();
  return rows
    .filter((r) => !r.lead || r.lead.id !== leadId)
    .map((r) => ({
      id: r.id,
      startsAt: r.startsAt.toISOString(),
      deviceName: r.device.name,
      title: r.title,
      clientName: r.client?.shortName ?? r.client?.name ?? null,
      totalNet: r.finance ? Number(r.finance.totalNet.toString()) : null,
      sameClient: Boolean(lead.clientId && r.clientId === lead.clientId),
      linkedLeadTitle: r.lead?.title ?? null,
    }))
    .sort((a, b) => Number(b.sameClient) - Number(a.sameClient) || Number(!!a.linkedLeadTitle) - Number(!!b.linkedLeadTitle) || Math.abs(new Date(a.startsAt).getTime() - around) - Math.abs(new Date(b.startsAt).getTime() - around))
    .slice(0, 20);
}
