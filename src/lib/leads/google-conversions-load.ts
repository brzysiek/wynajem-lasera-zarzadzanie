import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CLICK_MAX_AGE_DAYS,
  CONVERSIONS,
  SKIP_LABEL,
  conversionsFor,
  eligibility,
  type Attr,
  type Candidate,
  type LeadForConversions,
  type SkipReason,
} from "@/lib/leads/google-conversions";
import { normalizeAttribution } from "@/lib/leads/attribution-view";
import type { LeadStageKey } from "@/lib/leads/parse-deal";

// Wniosek 54, etap 1: które konwersje czekają na wgranie do Google Ads.
// Bierzemy sygnały z ostatnich 90 dni z atrybucją (formularze WWW), sprawdzamy
// kwalifikację (zgoda marketingowa, identyfikator, nie test / archiwum) i
// odejmujemy to, co już wyeksportowano (orderId).

export type ConversionPreview = {
  pending: Candidate[]; // jeszcze nie wyeksportowane
  already: number; // wyeksportowane wcześniej (do ponownego pobrania)
  alreadyRows: Candidate[];
  leadsChecked: number;
  leadsEligible: number;
  skipped: { reason: SkipReason; label: string; leads: number }[];
  byName: { name: string; pending: number; withoutValue: number }[];
};

export async function loadConversionCandidates(now = new Date()): Promise<{ all: Candidate[]; exportedIds: Set<string>; leadsChecked: number; leadsEligible: number; skipped: Map<SkipReason, number> }> {
  const since = new Date(now.getTime() - CLICK_MAX_AGE_DAYS * 86_400_000);
  const rows = await prisma.lead.findMany({
    where: { createdAt: { gte: since }, attribution: { not: Prisma.DbNull } },
    select: {
      id: true,
      createdAt: true,
      stage: true,
      stageChangedAt: true,
      archivedAt: true,
      contactEmail: true,
      firstContactAt: true,
      attribution: true,
      rentalId: true,
      rental: { select: { createdAt: true, finance: { select: { totalNet: true } } } },
      activities: { where: { type: { in: ["STAGE_CHANGE", "CALL", "EMAIL"] } }, select: { type: true, body: true, createdAt: true } },
    },
  });
  const exported = await prisma.googleConversionExport.findMany({ where: { leadId: { in: rows.map((r) => r.id) } }, select: { orderId: true } });
  const all: Candidate[] = [];
  const skipped = new Map<SkipReason, number>();
  let eligible = 0;
  for (const r of rows) {
    const lead: LeadForConversions = {
      id: r.id,
      createdAt: r.createdAt,
      stage: r.stage as LeadStageKey,
      stageChangedAt: r.stageChangedAt,
      archivedAt: r.archivedAt,
      contactEmail: r.contactEmail,
      firstContactAt: r.firstContactAt,
      attribution: normalizeAttribution(r.attribution) as Attr | null,
      rentalId: r.rentalId,
      rentalCreatedAt: r.rental?.createdAt ?? null,
      rentalNet: r.rental?.finance ? Number(r.rental.finance.totalNet) : null,
      activities: r.activities,
    };
    const e = eligibility(lead, now);
    if ("skip" in e) {
      skipped.set(e.skip, (skipped.get(e.skip) ?? 0) + 1);
      continue;
    }
    eligible++;
    all.push(...conversionsFor(lead, e.click));
  }
  return { all, exportedIds: new Set(exported.map((x) => x.orderId)), leadsChecked: rows.length, leadsEligible: eligible, skipped };
}

export async function conversionPreview(now = new Date()): Promise<ConversionPreview> {
  const c = await loadConversionCandidates(now);
  const pending = c.all.filter((x) => !c.exportedIds.has(x.orderId));
  const alreadyRows = c.all.filter((x) => c.exportedIds.has(x.orderId));
  return {
    pending,
    already: alreadyRows.length,
    alreadyRows,
    leadsChecked: c.leadsChecked,
    leadsEligible: c.leadsEligible,
    skipped: [...c.skipped].map(([reason, leads]) => ({ reason, label: SKIP_LABEL[reason], leads })).sort((a, b) => b.leads - a.leads),
    byName: CONVERSIONS.map((d) => {
      const rows = pending.filter((x) => x.def.key === d.key);
      return { name: d.name, pending: rows.length, withoutValue: rows.filter((x) => x.value == null).length };
    }),
  };
}

// Zapisuje partię jako wyeksportowaną (po wygenerowaniu pliku).
export async function markExported(rows: Candidate[], batch: string): Promise<number> {
  if (!rows.length) return 0;
  const res = await prisma.googleConversionExport.createMany({
    data: rows.map((r) => ({
      leadId: r.leadId,
      orderId: r.orderId,
      conversionName: r.def.name,
      value: r.value,
      clickIdKind: r.click.kind,
      conversionAt: r.at,
      batch,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

// Szczegół sygnału: co z tego sygnału już poszło do Google.
export async function leadGoogleExports(leadId: string): Promise<{ name: string; at: string }[]> {
  const rows = await prisma.googleConversionExport.findMany({ where: { leadId }, orderBy: { exportedAt: "asc" }, select: { conversionName: true, exportedAt: true } });
  return rows.map((r) => ({ name: r.conversionName, at: r.exportedAt.toISOString() }));
}
