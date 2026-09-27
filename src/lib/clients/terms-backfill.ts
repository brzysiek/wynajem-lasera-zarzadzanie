import { prisma } from "@/lib/prisma";
import { recordChanges, type ChangeEntry } from "@/lib/changelog/record";
import { saveRentalFinance } from "@/lib/finance";
import { rentalDurationDays } from "@/lib/pricing/duration";
import { warsawYmd } from "@/lib/clients/day-route";
import { deviceCodeFor, parseInvoiceMode, positionsSummary } from "@/lib/clients/terms-rules";
import { compareWithTerms, planBackfill, type BackfillPlan, type PlanTerms } from "@/lib/clients/terms-backfill-rules";

// Kwoty wg warunków (karta klienta, etap D): przyszłe rezerwacje bez
// rozliczenia u klientów z tabelą cen — plan uzupełnienia i wykonanie; oraz
// lista rezerwacji, w których wpisana kwota różni się od warunków (dla Ani).

export type BackfillRow = {
  rentalId: string;
  title: string;
  startsAt: string;
  clientId: string;
  clientName: string;
  deviceName: string;
  days: number;
  plan: BackfillPlan;
  positions: string | null;
};

export type MismatchRow = {
  rentalId: string;
  title: string;
  startsAt: string;
  clientId: string;
  clientName: string;
  deviceName: string;
  days: number;
  baseNet: number;
  expectedBase: number | null;
  pct: number | null;
  transportNet: number | null;
  expectedTransport: number | null;
  big: boolean;
};

const SELECT = {
  id: true,
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  clientId: true,
  device: { select: { name: true, pricingCategory: true, variantOptions: true } },
  finance: { select: { baseRentalPriceNet: true, baseRentalPriceSource: true, deviceVariant: true, transportPriceNet: true } },
} as const;

async function load(today: Date) {
  const clients = await prisma.client.findMany({
    where: { archivedAt: null, prices: { some: {} } },
    select: {
      id: true,
      name: true,
      shortName: true,
      transportPriceNet: true,
      paymentForm: true,
      invoiceMode: true,
      invoicePartDefault: true,
      prices: { select: { device: true, days: true, priceNet: true } },
    },
  });
  const terms = new Map(
    clients.map((c) => [
      c.id,
      {
        name: c.shortName ?? c.name,
        terms: {
          prices: c.prices.map((p) => ({ device: p.device, days: p.days, priceNet: Number(p.priceNet) })),
          transportNet: c.transportPriceNet != null ? Number(c.transportPriceNet) : null,
          paymentForm: c.paymentForm,
          invoiceMode: parseInvoiceMode(c.invoiceMode),
          invoicePartDefault: c.invoicePartDefault != null ? Number(c.invoicePartDefault) : null,
        } satisfies PlanTerms,
      },
    ]),
  );
  const rentals = await prisma.rental.findMany({
    where: { deletedInGoogle: false, eventType: "WYNAJEM", startsAt: { gt: today }, clientId: { in: [...terms.keys()] } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: SELECT,
  });
  const priceList = (await prisma.priceRule.findMany({ select: { pricingCategory: true, variant: true, durationDays: true, priceNet: true } })).map((p) => ({
    category: p.pricingCategory,
    variant: p.variant,
    days: p.durationDays,
    priceNet: Number(p.priceNet),
  }));
  return { terms, rentals, priceList };
}

type Loaded = Awaited<ReturnType<typeof load>>;

function plans({ terms, rentals, priceList }: Loaded): BackfillRow[] {
  // „2 urządzenia jednego dnia = 1 kurs”: dzień już z transportem (wpisanym
  // albo z planu wcześniejszej rezerwacji tego dnia) — kolejne bez transportu.
  const dayTaken = new Set(
    rentals.filter((r) => r.finance && (r.finance.transportPriceNet == null || Number(r.finance.transportPriceNet) > 0)).map((r) => `${r.clientId}|${warsawYmd(r.startsAt)}`),
  );
  const out: BackfillRow[] = [];
  for (const r of rentals) {
    if (r.finance) continue;
    const t = terms.get(r.clientId!)!;
    const key = `${r.clientId}|${warsawYmd(r.startsAt)}`;
    const days = rentalDurationDays(r.startsAt, r.endsAt);
    const variantOptions = Array.isArray(r.device.variantOptions) ? (r.device.variantOptions as unknown[]).filter((v): v is string => typeof v === "string") : [];
    const plan = planBackfill({ title: r.title, description: r.description, category: r.device.pricingCategory, variantOptions, days }, t.terms, priceList, dayTaken.has(key));
    if (plan.ready && plan.transportNet > 0) dayTaken.add(key);
    out.push({
      rentalId: r.id,
      title: r.title,
      startsAt: r.startsAt.toISOString(),
      clientId: r.clientId!,
      clientName: t.name,
      deviceName: r.device.name,
      days,
      plan,
      positions: plan.ready
        ? positionsSummary({ eventType: "WYNAJEM", baseNet: plan.baseNet, transportNet: plan.transportNet, pulseSurchargeNet: null, pulsesPending: r.device.pricingCategory === "ALMA_HARMONY", capNet: null, membraneNet: null })
        : null,
    });
  }
  return out;
}

export type LegacyTermsRow = { clientId: string; clientName: string; agreedPrice: number; transportNet: number | null; notes: string | null };

export async function loadTermsReview(
  today = new Date(),
): Promise<{ backfill: BackfillRow[]; mismatches: MismatchRow[]; clientsWithTerms: number; legacy: LegacyTermsRow[] }> {
  const loaded = await load(today);
  // Dawna „cena ustalona” bez tabeli cen — do rozpisania na urządzenia (karta
  // klienta → Warunki handlowe → Edytuj, albo propozycje agenta cennik_klienta).
  const legacy = (
    await prisma.client.findMany({
      where: { archivedAt: null, agreedPrice: { not: null }, prices: { none: {} } },
      select: { id: true, name: true, shortName: true, agreedPrice: true, transportPriceNet: true, paymentTerms: true },
      orderBy: { name: "asc" },
    })
  ).map((c) => ({ clientId: c.id, clientName: c.shortName ?? c.name, agreedPrice: Number(c.agreedPrice), transportNet: c.transportPriceNet != null ? Number(c.transportPriceNet) : null, notes: c.paymentTerms }));
  const backfill = plans(loaded);
  const withTransport = new Map<string, number>();
  for (const r of loaded.rentals) if (r.finance && Number(r.finance.transportPriceNet ?? 0) > 0) {
    const k = `${r.clientId}|${warsawYmd(r.startsAt)}`;
    withTransport.set(k, (withTransport.get(k) ?? 0) + 1);
  }
  const mismatches: MismatchRow[] = [];
  for (const r of loaded.rentals) {
    const f = r.finance;
    if (!f || f.baseRentalPriceSource === "PULSE_CALCULATED") continue;
    const t = loaded.terms.get(r.clientId!)!;
    const days = rentalDurationDays(r.startsAt, r.endsAt);
    const transport = f.transportPriceNet != null ? Number(f.transportPriceNet) : null;
    const k = `${r.clientId}|${warsawYmd(r.startsAt)}`;
    // Transport tego dnia już jest w innej rezerwacji — tu oczekujemy 0.
    const takenByOther = (withTransport.get(k) ?? 0) - (transport && transport > 0 ? 1 : 0) > 0;
    const code = deviceCodeFor("WYNAJEM", r.device.pricingCategory, f.deviceVariant);
    const cmp = compareWithTerms({ baseNet: Number(f.baseRentalPriceNet), transportNet: transport, code, days }, t.terms, takenByOther);
    if (!cmp) continue;
    mismatches.push({
      rentalId: r.id,
      title: r.title,
      startsAt: r.startsAt.toISOString(),
      clientId: r.clientId!,
      clientName: t.name,
      deviceName: r.device.name,
      days,
      baseNet: Number(f.baseRentalPriceNet),
      expectedBase: cmp.base?.expected ?? null,
      pct: cmp.base?.pct ?? null,
      transportNet: transport,
      expectedTransport: cmp.transport?.expected ?? null,
      big: cmp.big,
    });
  }
  return { backfill, mismatches, clientsWithTerms: loaded.terms.size, legacy };
}

// Wykonanie dla wskazanych rezerwacji — plan liczony od nowa na serwerze;
// zapis tą samą drogą co formularz rezerwacji (saveRentalFinance).
export async function applyBackfill(rentalIds: string[], actor: { userId: string }, today = new Date()): Promise<{ done: number; skipped: { rentalId: string; reason: string }[] }> {
  const loaded = await load(today);
  const wanted = new Set(rentalIds);
  const rows = plans(loaded).filter((r) => wanted.has(r.rentalId));
  const skipped: { rentalId: string; reason: string }[] = [];
  const entries: ChangeEntry[] = [];
  let done = 0;
  for (const r of rows) {
    if (!r.plan.ready) {
      skipped.push({ rentalId: r.rentalId, reason: r.plan.reason });
      continue;
    }
    const rental = await prisma.rental.findUnique({
      where: { id: r.rentalId },
      select: { id: true, clientId: true, eventType: true, startsAt: true, endsAt: true, transportPrice: true, device: { select: { pricingCategory: true } }, finance: true },
    });
    if (!rental || rental.finance) {
      skipped.push({ rentalId: r.rentalId, reason: "rozliczenie już jest" });
      continue;
    }
    const res = await saveRentalFinance(rental, {
      deviceVariant: r.plan.variant,
      vatApplicable: r.plan.vatApplicable,
      paymentMethod: r.plan.paymentMethod,
      transportPriceNet: String(r.plan.transportNet),
      invoiceNet: r.plan.invoicePart != null ? String(r.plan.invoicePart) : "",
    });
    if (!res.ok) {
      skipped.push({ rentalId: r.rentalId, reason: res.message });
      continue;
    }
    done++;
    entries.push({ entity: "RENTAL", entityId: r.rentalId, operation: "FIELD_CHANGE", clientId: r.clientId, field: "rozliczenie wg warunków klienta", before: null, after: r.positions });
  }
  await recordChanges(prisma, actor, entries);
  return { done, skipped };
}
