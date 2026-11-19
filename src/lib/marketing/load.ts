import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { maxStageReached } from "@/lib/leads/funnel";
import { STAGE_HISTORY_LABELS } from "@/lib/leads/labels";
import { normalizeAttribution } from "@/lib/leads/attribution-view";
import type { LeadStageKey } from "@/lib/leads/parse-deal";
import { attributeSource, type Attr } from "./source";
import { buildReport, countsInReport, isReturningLead, type PriorRental, type Report, type ReportLead } from "./report";
import type { CostRow } from "./costs-csv";
import { addDays, isDay, warsawDay } from "./period";

// Wniosek 54, etap 1b: wczytanie sygnałów i kosztów do raportu kampanii.

export { addDays, isDay, seasonStart, warsawDay } from "./period";

export function resolvePeriod(from: string | null | undefined, to: string | null | undefined, now = new Date()): { from: string; to: string } {
  const today = warsawDay(now);
  const t = isDay(to) ? to : today;
  const f = isDay(from) ? from : addDays(t, -27); // domyślnie ostatnie 28 dni
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

export async function loadCampaignReport(from: string, to: string): Promise<Report> {
  // Szeroki zakres w bazie (strefa czasowa), dokładny filtr po dniu Europe/Warsaw.
  const rows = await prisma.lead.findMany({
    where: { createdAt: { gte: new Date(`${addDays(from, -1)}T00:00:00Z`), lte: new Date(`${addDays(to, 2)}T00:00:00Z`) } },
    select: {
      id: true,
      clientId: true,
      title: true,
      type: true,
      stage: true,
      createdAt: true,
      firstContactAt: true,
      attribution: true,
      returningClient: true,
      lostReason: true,
      rentalId: true,
      contactEmail: true,
      archivedAt: true,
      archiveReason: true,
      utmSource: true,
      utmCampaign: true,
      gclid: true,
      client: { select: { source: true, marketingExcluded: true } },
      rental: { select: { finance: { select: { totalNet: true } } } },
      activities: { where: { type: { in: ["STAGE_CHANGE", "CALL", "EMAIL"] } }, select: { type: true, body: true } },
    },
  });
  // Wcześniejsze rezerwacje i wynajmy klienta (kalendarz + historia) — stała klientka mimo braku flagi.
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter((x): x is string => Boolean(x)))];
  const [rentalRows, historyRows] = clientIds.length
    ? await Promise.all([
        prisma.rental.findMany({ where: { clientId: { in: clientIds }, eventType: "WYNAJEM", deletedInGoogle: false }, select: { id: true, clientId: true, startsAt: true, createdAt: true } }),
        prisma.rentalHistory.findMany({ where: { clientId: { in: clientIds }, kind: "WYNAJEM", matchState: { in: ["AUTO", "CONFIRMED"] } }, select: { clientId: true, startsAt: true } }),
      ])
    : [[], []];
  const priorOf = (clientId: string | null): { rentals: PriorRental[]; history: Date[] } => ({
    rentals: clientId ? rentalRows.filter((x) => x.clientId === clientId).map((x) => ({ id: x.id, startsAt: x.startsAt, createdAt: x.createdAt })) : [],
    history: clientId ? historyRows.filter((x) => x.clientId === clientId).map((x) => x.startsAt) : [],
  });
  const leads: ReportLead[] = [];
  for (const r of rows) {
    const day = warsawDay(r.createdAt);
    if (day < from || day > to) continue;
    if (r.client?.marketingExcluded) continue; // dostawca / partner — poza wszystkimi liczbami w Marketingu
    if (!countsInReport({ contactEmail: r.contactEmail, archivedAt: r.archivedAt, archiveReason: r.archiveReason })) continue;
    const talked = r.activities.some((a) => a.type === "CALL" || a.type === "EMAIL");
    const maxStage = maxStageReached(
      r.stage as LeadStageKey,
      r.activities.filter((a) => a.type === "STAGE_CHANGE").map((a) => a.body),
      STAGE_HISTORY_LABELS,
      Boolean(r.rentalId),
      r.firstContactAt != null || talked,
    );
    leads.push({
      id: r.id,
      title: r.title,
      type: r.type,
      stage: r.stage,
      createdAt: r.createdAt,
      maxStage,
      talked,
      returning: isReturningLead(r.returningClient, priorOf(r.clientId), { createdAt: r.createdAt, rentalId: r.rentalId }),
      lostReason: r.lostReason,
      revenue: r.rental?.finance ? Number(r.rental.finance.totalNet) : null,
      contactEmail: r.contactEmail,
      archivedAt: r.archivedAt,
      archiveReason: r.archiveReason,
      source: attributeSource({
        attribution: normalizeAttribution(r.attribution) as Attr | null,
        type: r.type,
        clientSource: r.client?.source ?? null,
        legacy: { utmSource: r.utmSource, utmCampaign: r.utmCampaign, gclid: r.gclid },
      }),
    });
  }
  const costs = await loadCosts(from, to);
  return buildReport({ leads, costs, from, to, localDay: warsawDay });
}

export async function loadCosts(from: string, to: string): Promise<CostRow[]> {
  const rows = await prisma.adCostDay.findMany({ where: { channel: "GOOGLE_ADS", day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } } });
  return rows.map((c) => ({
    day: c.day.toISOString().slice(0, 10),
    campaignKey: c.campaignKey,
    campaignName: c.campaignName,
    adGroupId: c.adGroupId,
    adGroupName: c.adGroupName,
    keyword: c.keyword,
    keywordText: c.keywordText,
    impressions: c.impressions,
    clicks: c.clicks,
    cost: Number(c.cost),
  }));
}

// Zapis importu: dni z zakresu pliku (od najwcześniejszego do najpóźniejszego)
// są najpierw czyszczone, potem wstawiane — ponowny import tych samych dni
// nadpisuje je, bez dubli.
export async function saveCosts(rows: CostRow[], batch: string): Promise<{ deleted: number; inserted: number; dayFrom: string; dayTo: string }> {
  if (!rows.length) return { deleted: 0, inserted: 0, dayFrom: "", dayTo: "" };
  const days = rows.map((r) => r.day).sort();
  const dayFrom = days[0];
  const dayTo = days[days.length - 1];
  const data: Prisma.AdCostDayCreateManyInput[] = rows.map((r) => ({
    channel: "GOOGLE_ADS",
    day: new Date(`${r.day}T00:00:00Z`),
    campaignKey: r.campaignKey.slice(0, 120),
    campaignName: r.campaignName.slice(0, 191),
    adGroupId: r.adGroupId.slice(0, 40),
    adGroupName: r.adGroupName.slice(0, 150),
    keyword: r.keyword.slice(0, 150),
    keywordText: r.keywordText.slice(0, 191),
    impressions: r.impressions,
    clicks: r.clicks,
    cost: r.cost,
    importBatch: batch,
  }));
  return prisma.$transaction(async (tx) => {
    const del = await tx.adCostDay.deleteMany({ where: { channel: "GOOGLE_ADS", day: { gte: new Date(`${dayFrom}T00:00:00Z`), lte: new Date(`${dayTo}T00:00:00Z`) } } });
    let inserted = 0;
    for (let i = 0; i < data.length; i += 500) inserted += (await tx.adCostDay.createMany({ data: data.slice(i, i + 500), skipDuplicates: true })).count;
    return { deleted: del.count, inserted, dayFrom, dayTo };
  }, { timeout: 60_000 });
}

export async function costStatus(): Promise<{ days: number; from: string | null; to: string | null; lastImportAt: string | null; totalCost: number }> {
  const [agg, last, days] = await Promise.all([
    prisma.adCostDay.aggregate({ where: { channel: "GOOGLE_ADS" }, _min: { day: true }, _max: { day: true }, _sum: { cost: true } }),
    prisma.adCostDay.findFirst({ where: { channel: "GOOGLE_ADS" }, orderBy: { importedAt: "desc" }, select: { importedAt: true } }),
    prisma.adCostDay.groupBy({ by: ["day"], where: { channel: "GOOGLE_ADS" } }),
  ]);
  return {
    days: days.length,
    from: agg._min.day?.toISOString().slice(0, 10) ?? null,
    to: agg._max.day?.toISOString().slice(0, 10) ?? null,
    lastImportAt: last?.importedAt.toISOString() ?? null,
    totalCost: Number(agg._sum.cost ?? 0),
  };
}
