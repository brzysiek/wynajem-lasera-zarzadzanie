import type { Client } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readFieldMeta, type ClientLinks, type DeliveryNotes, type FieldMeta, type FrameAgreement, type GoogleReview, type MarketingConsent, type PkdEntry } from "@/lib/clients/profile-fields";

// Karta klienta (sekcje 2–3): nowe pola w postaci gotowej do wysłania do
// przeglądarki, szanse sprzedaży i powiązania (wydzielona z / scalona z).

export type ClientProfileDto = {
  shortName: string | null;
  regon: string | null;
  legalForm: string | null;
  businessStartDate: string | null;
  pkd: PkdEntry[];
  vatStatus: string | null;
  bankAccounts: string[];
  deliveryAddress: string | null;
  deliveryNotes: DeliveryNotes | null;
  services: string[];
  openingHours: string | null;
  links: ClientLinks | null;
  ownDevices: string | null;
  seasonality: string | null;
  agreedPrice: string | null;
  paymentTerms: string | null;
  paymentForm: "GOTOWKA" | "PRZELEW" | "OBA" | null;
  paymentTermDays: number | null;
  invoiceMode: "FULL" | "PARTIAL" | "NONE" | null;
  invoicePartDefault: string | null;
  pulsesCharged: boolean | null;
  pulseRateNet: string | null;
  invoiceEmail: string | null;
  invoiceBuyerName: string | null;
  invoiceBuyerNip: string | null;
  frameAgreement: FrameAgreement | null;
  marketingConsent: MarketingConsent | null;
  smsReminders: boolean | null;
  googleReview: GoogleReview | null;
  nextStep: { text: string; dueAt: string | null } | null;
  enrichedAt: string | null;
};

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const objOrNull = <T>(v: unknown): T | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null);

export function profileDto(c: Client): ClientProfileDto {
  return {
    shortName: c.shortName,
    regon: c.regon,
    legalForm: c.legalForm,
    businessStartDate: c.businessStartDate?.toISOString() ?? null,
    pkd: arr<PkdEntry>(c.pkd),
    vatStatus: c.vatStatus,
    bankAccounts: arr<string>(c.bankAccounts),
    deliveryAddress: c.deliveryAddress,
    deliveryNotes: objOrNull<DeliveryNotes>(c.deliveryNotes),
    services: arr<string>(c.services),
    openingHours: c.openingHours,
    links: objOrNull<ClientLinks>(c.links),
    ownDevices: c.ownDevices,
    seasonality: c.seasonality,
    agreedPrice: c.agreedPrice?.toString() ?? null,
    paymentTerms: c.paymentTerms,
    paymentForm: (c.paymentForm as ClientProfileDto["paymentForm"]) ?? null,
    paymentTermDays: c.paymentTermDays,
    invoiceMode: (c.invoiceMode as ClientProfileDto["invoiceMode"]) ?? null,
    invoicePartDefault: c.invoicePartDefault?.toString() ?? null,
    pulsesCharged: c.pulsesCharged,
    pulseRateNet: c.pulseRateNet?.toString() ?? null,
    invoiceEmail: c.invoiceEmail,
    invoiceBuyerName: c.invoiceBuyerName,
    invoiceBuyerNip: c.invoiceBuyerNip,
    frameAgreement: objOrNull<FrameAgreement>(c.frameAgreement),
    marketingConsent: objOrNull<MarketingConsent>(c.marketingConsent),
    smsReminders: c.smsReminders,
    googleReview: objOrNull<GoogleReview>(c.googleReview),
    nextStep: c.nextStepText ? { text: c.nextStepText, dueAt: c.nextStepDueAt?.toISOString() ?? null } : null,
    enrichedAt: c.enrichedAt?.toISOString() ?? null,
  };
}

export type OpportunityDto = {
  id: string;
  device: string;
  stage: string;
  chance: string | null;
  lastContact: string | null;
  returnAt: string | null;
  note: string | null;
  source: string | null;
  closedAt: string | null;
  createdAt: string;
};

export type LineageDto = { kind: "SPLIT_FROM" | "SPLIT_TO" | "MERGED_FROM"; at: string; otherId: string | null; otherName: string | null }[];

// Pochodzenie pól z nazwami osób (verifiedBy = id użytkownika).
export type FieldMetaDto = Record<string, { source: string; sourceRef: string | null; verifiedAt: string; verifiedBy: string | null; lockedManual: boolean }>;

export async function loadCardExtras(clientId: string, metas: unknown[]) {
  const [opportunities, logs] = await Promise.all([
    prisma.clientOpportunity.findMany({ where: { clientId }, orderBy: [{ closedAt: "asc" }, { createdAt: "desc" }] }),
    prisma.changeLog.findMany({
      where: { entity: "CLIENT", entityId: clientId, operation: { in: ["SPLIT", "MERGE"] } },
      orderBy: { createdAt: "desc" },
      select: { operation: true, before: true, after: true, createdAt: true },
      take: 20,
    }),
  ]);
  const lineage: LineageDto = [];
  for (const l of logs) {
    const before = safeJson(l.before);
    const after = safeJson(l.after);
    if (l.operation === "SPLIT" && before?.z) lineage.push({ kind: "SPLIT_FROM", at: l.createdAt.toISOString(), otherId: before.z.id ?? null, otherName: before.z.nazwa ?? null });
    else if (l.operation === "SPLIT" && after?.wydzielono) lineage.push({ kind: "SPLIT_TO", at: l.createdAt.toISOString(), otherId: after.wydzielono.id ?? null, otherName: after.wydzielono.nazwa ?? null });
    else if (l.operation === "MERGE") {
      const dup = before?.scalony ?? null;
      if (!dup) continue;
      lineage.push({ kind: "MERGED_FROM", at: l.createdAt.toISOString(), otherId: dup?.id ?? null, otherName: dup?.nazwa ?? dup?.name ?? null });
    }
  }
  const userIds = [...new Set(metas.flatMap((m) => Object.values(readFieldMeta(m)).map((e) => e.verifiedBy)).filter((x): x is string => !!x))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const withNames = (m: unknown): FieldMetaDto => {
    const out: FieldMetaDto = {};
    for (const [k, e] of Object.entries(readFieldMeta(m) as FieldMeta)) out[k] = { ...e, verifiedBy: e.verifiedBy ? (userName.get(e.verifiedBy) ?? e.verifiedBy) : null };
    return out;
  };
  return {
    opportunities: opportunities.map(
      (o): OpportunityDto => ({
        id: o.id,
        device: o.device,
        stage: o.stage,
        chance: o.chance,
        lastContact: o.lastContact?.toISOString() ?? null,
        returnAt: o.returnAt?.toISOString() ?? null,
        note: o.note,
        source: o.source,
        closedAt: o.closedAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
      }),
    ),
    lineage,
    withNames,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeJson(s: string | null): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
