import { prisma } from "@/lib/prisma";
import { recordChanges, type ChangeEntry } from "@/lib/changelog/record";
import { saveRentalFinance } from "@/lib/finance";
import { rentalDurationDays } from "@/lib/pricing/duration";
import { warsawYmd } from "@/lib/clients/day-route";
import { TERMS_DEVICE_LABEL, invoiceDefaults, parseInvoiceMode, positionsSummary, termsVariantFor } from "@/lib/clients/terms-rules";
import { logError } from "@/lib/logger";
import { loadDeliverySettings } from "@/lib/clients/delivery";
import { zoneFor } from "@/lib/clients/delivery-rules";
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
  // Klient ma w warunkach tylko inny wariant (np. „LightSheer 1 głowica”) —
  // porównanie z nim.
  otherVariant: string | null;
};

// Stała kwota transportu vs strefa z trasy od bazy (wniosek 15) — do
// przeglądu przy zmianie cennika; nic nie nadpisuje.
export type TransportZoneRow = {
  clientId: string;
  clientName: string;
  km: number;
  zone: string;
  zonePrice: number | null;
  fixed: number;
  since: string | null;
  diff: number | null;
};

// Kwota na FV do ustalenia (warunki „część” bez kwoty) — wniosek 17.
export type PendingInvoiceRow = { rentalId: string; title: string; startsAt: string; clientId: string | null; clientName: string | null; deviceName: string; totalNet: number };

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
): Promise<{ backfill: BackfillRow[]; mismatches: MismatchRow[]; clientsWithTerms: number; legacy: LegacyTermsRow[]; pending: PendingInvoiceRow[]; transportZones: TransportZoneRow[] }> {
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
    const cmp = compareWithTerms({ baseNet: Number(f.baseRentalPriceNet), transportNet: transport, category: r.device.pricingCategory, variant: f.deviceVariant, days }, t.terms, takenByOther);
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
      otherVariant: cmp.base?.otherVariant ? TERMS_DEVICE_LABEL[cmp.base.otherVariant] : null,
    });
  }
  const pending = (
    await prisma.rental.findMany({
      where: { deletedInGoogle: false, startsAt: { gt: today }, finance: { invoiceNetPending: true } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: { id: true, title: true, startsAt: true, clientId: true, client: { select: { name: true, shortName: true } }, device: { select: { name: true } }, finance: { select: { totalNet: true } } },
    })
  ).map((r) => ({
    rentalId: r.id,
    title: r.title,
    startsAt: r.startsAt.toISOString(),
    clientId: r.clientId,
    clientName: r.client ? (r.client.shortName ?? r.client.name) : null,
    deviceName: r.device.name,
    totalNet: Number(r.finance!.totalNet),
  }));
  const { zones } = await loadDeliverySettings();
  const transportZones = (
    await prisma.client.findMany({
      where: { archivedAt: null, transportPriceNet: { not: null } },
      select: { id: true, name: true, shortName: true, transportPriceNet: true, transportPriceSince: true, distanceKm: true, deliveryAddresses: { where: { isDefault: true }, take: 1, select: { distanceKm: true } } },
    })
  )
    .flatMap((c) => {
      const km = c.deliveryAddresses[0]?.distanceKm ?? c.distanceKm;
      const z = km != null ? zoneFor(Number(km), zones) : null;
      if (!z) return [];
      const fixed = Number(c.transportPriceNet);
      return [
        {
          clientId: c.id,
          clientName: c.shortName ?? c.name,
          km: Number(km),
          zone: z.code,
          zonePrice: z.priceNet,
          fixed,
          since: c.transportPriceSince?.toISOString() ?? null,
          diff: z.priceNet != null ? Math.round((fixed - z.priceNet) * 100) / 100 : null,
        },
      ];
    })
    .sort((a, b) => Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0) || b.km - a.km);
  return { backfill, mismatches, clientsWithTerms: loaded.terms.size, legacy, pending, transportZones };
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
      invoiceNetPending: r.plan.invoicePending,
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

// Po zapisie / akceptacji warunków klienta (tabela cen, transport, faktura,
// płatność, impulsy): przyszłe rezerwacje tego klienta dostają kwoty z
// warunków — bez rozliczenia: plan jak wyżej; z ceną z cennika albo z
// warunków: przeliczenie. Ręczne kwoty (MANUAL), potwierdzone przez kierowcę
// i z wystawioną fakturą — bez zmian (ręczne trafiają na listę rozbieżności).
export type TermsSyncChange = { rentalId: string; title: string; startsAt: string; before: string | null; after: string };
export type TermsSyncResult = { filled: number; updated: number; manual: number; changes: TermsSyncChange[] };

export async function syncFutureRentalsToTerms(
  clientId: string,
  actor: { userId: string },
  today = new Date(),
  // dryRun (wniosek 28): tylko podgląd — co by się zmieniło, bez zapisu.
  opts: { fillMissing?: boolean; dryRun?: boolean } = {},
): Promise<TermsSyncResult> {
  const out: TermsSyncResult = { filled: 0, updated: 0, manual: 0, changes: [] };
  const c = await prisma.client.findUnique({
    where: { id: clientId },
    select: { transportPriceNet: true, paymentForm: true, invoiceMode: true, invoicePartDefault: true, prices: { select: { device: true, days: true, priceNet: true } } },
  });
  // Bez tabeli cen i bez transportu ustalonego — nie ma czego stosować.
  if (!c || (c.prices.length === 0 && c.transportPriceNet == null)) return out;
  const terms: PlanTerms = {
    prices: c.prices.map((p) => ({ device: p.device, days: p.days, priceNet: Number(p.priceNet) })),
    transportNet: c.transportPriceNet != null ? Number(c.transportPriceNet) : null,
    paymentForm: c.paymentForm,
    invoiceMode: parseInvoiceMode(c.invoiceMode),
    invoicePartDefault: c.invoicePartDefault != null ? Number(c.invoicePartDefault) : null,
  };
  const inv = invoiceDefaults(terms.invoiceMode, terms.invoicePartDefault);
  const pay = terms.paymentForm === "GOTOWKA" ? "CASH" : terms.paymentForm === "PRZELEW" ? "TRANSFER" : null;
  const [rentals, priceRules] = await Promise.all([
    prisma.rental.findMany({
      where: { clientId, deletedInGoogle: false, eventType: "WYNAJEM", startsAt: { gt: today } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: { id: true, title: true, description: true, clientId: true, eventType: true, startsAt: true, endsAt: true, transportPrice: true, device: { select: { pricingCategory: true, variantOptions: true } }, finance: true },
    }),
    prisma.priceRule.findMany({ select: { pricingCategory: true, variant: true, durationDays: true, priceNet: true } }),
  ]);
  const priceList = priceRules.map((p) => ({ category: p.pricingCategory, variant: p.variant, days: p.durationDays, priceNet: Number(p.priceNet) }));
  const isFixed = (f: NonNullable<(typeof rentals)[number]["finance"]>) =>
    f.baseRentalPriceSource === "MANUAL" || f.baseRentalPriceSource === "PULSE_CALCULATED" || f.confirmedAt != null || f.fakturowniaInvoiceId != null;
  // Dzień z transportem: najpierw rezerwacje, których nie ruszamy.
  const dayTaken = new Set(rentals.filter((r) => r.finance && isFixed(r.finance) && Number(r.finance.transportPriceNet ?? 0) > 0).map((r) => warsawYmd(r.startsAt)));
  const entries: ChangeEntry[] = [];
  const summary = (f: { baseRentalPriceNet: unknown; transportPriceNet: unknown; totalNet: unknown; deviceVariant: string | null; invoiceNetPending: boolean }) =>
    `wynajem ${Number(f.baseRentalPriceNet)}${f.deviceVariant ? ` (${f.deviceVariant})` : ""} · transport ${Number(f.transportPriceNet ?? 0)} · razem ${Number(f.totalNet)}${f.invoiceNetPending ? " · FV do ustalenia" : ""}`;

  for (const r of rentals) {
    const day = warsawYmd(r.startsAt);
    const f = r.finance;
    if (f && isFixed(f)) {
      if (f.baseRentalPriceSource === "MANUAL") out.manual++;
      continue;
    }
    const days = rentalDurationDays(r.startsAt, r.endsAt);
    let input: Parameters<typeof saveRentalFinance>[1];
    if (!f && opts.fillMissing === false) continue;
    if (!f) {
      const variantOptions = Array.isArray(r.device.variantOptions) ? (r.device.variantOptions as unknown[]).filter((v): v is string => typeof v === "string") : [];
      const plan = planBackfill({ title: r.title, description: r.description, category: r.device.pricingCategory, variantOptions, days }, terms, priceList, dayTaken.has(day));
      if (!plan.ready) continue;
      input = {
        deviceVariant: plan.variant,
        vatApplicable: plan.vatApplicable,
        paymentMethod: plan.paymentMethod,
        transportPriceNet: String(plan.transportNet),
        invoiceNet: plan.invoicePart != null ? String(plan.invoicePart) : "",
        invoiceNetPending: plan.invoicePending,
      };
    } else {
      const transport = terms.transportNet != null ? (dayTaken.has(day) ? 0 : terms.transportNet) : f.transportPriceNet != null ? Number(f.transportPriceNet) : null;
      const variantOptions = Array.isArray(r.device.variantOptions) ? (r.device.variantOptions as unknown[]).filter((v): v is string => typeof v === "string") : [];
      // „Część” bez kwoty: wpisana wcześniej część zostaje; bez niej — FV do ustalenia.
      const invoice = !inv
        ? { invoiceNet: f.invoiceNet != null ? f.invoiceNet.toString() : "", invoiceNetPending: f.invoiceNetPending }
        : inv.pending
          ? f.invoiceNet != null
            ? { invoiceNet: f.invoiceNet.toString(), invoiceNetPending: false }
            : { invoiceNet: "", invoiceNetPending: true }
          : { invoiceNet: inv.invoiceNet != null ? String(inv.invoiceNet) : "", invoiceNetPending: false };
      input = {
        deviceVariant: termsVariantFor(r.device.pricingCategory, f.deviceVariant, variantOptions, terms.prices, days),
        vatApplicable: inv ? inv.vatApplicable : f.vatApplicable,
        vatRate: f.vatRate.toString(),
        paymentMethod: pay ?? f.paymentMethod,
        transportPriceNet: transport != null ? String(transport) : "",
        transportPaidSeparately: f.transportPaidSeparately,
        transportVatApplicable: f.transportVatApplicable,
        transportPaymentMethod: f.transportPaymentMethod,
        ...invoice,
      };
    }
    const res = await saveRentalFinance(r, input, { dryRun: opts.dryRun });
    if (!res.ok) continue;
    const after = opts.dryRun ? res.data : await prisma.rentalFinance.findUnique({ where: { rentalId: r.id } });
    if (!after) continue;
    if (Number(after.transportPriceNet ?? 0) > 0) dayTaken.add(day);
    const changed =
      !f ||
      !f.totalNet.equals(after.totalNet) ||
      String(f.invoiceNet ?? "") !== String(after.invoiceNet ?? "") ||
      f.invoiceNetPending !== after.invoiceNetPending ||
      f.vatApplicable !== after.vatApplicable ||
      f.paymentMethod !== after.paymentMethod ||
      f.deviceVariant !== after.deviceVariant ||
      f.baseRentalPriceSource !== after.baseRentalPriceSource;
    if (!changed) continue;
    if (f) out.updated++;
    else out.filled++;
    out.changes.push({ rentalId: r.id, title: r.title, startsAt: r.startsAt.toISOString(), before: f ? summary(f) : null, after: summary(after) });
    entries.push({ entity: "RENTAL", entityId: r.id, operation: "FIELD_CHANGE", clientId, field: "rozliczenie wg warunków klienta", before: f ? summary(f) : null, after: summary(after) });
  }
  if (entries.length && !opts.dryRun) await recordChanges(prisma, actor, entries);
  return out;
}

// Przeliczenie policzonych już przyszłych rezerwacji wszystkich klientów z
// tabelą cen (strona Kwoty wg warunków) — po zmianie reguł (wniosek 17:
// wariant Almy z tabeli klienta, FV do ustalenia). Te same zasady co po
// zapisie warunków: ręczne, potwierdzone i zafakturowane bez zmian.
export async function syncAllFutureRentalsToTerms(actor: { userId: string }): Promise<{ clients: number; updated: number; manual: number }> {
  const clients = await prisma.client.findMany({ where: { archivedAt: null, prices: { some: {} } }, select: { id: true } });
  const out = { clients: clients.length, updated: 0, manual: 0 };
  for (const c of clients) {
    // Rezerwacje bez kwoty zostają do „Uzupełnij zaznaczone” (przegląd wyżej).
    let r: { updated: number; manual: number } | null = null;
    try {
      r = await syncFutureRentalsToTerms(c.id, actor, new Date(), { fillMissing: false });
    } catch (err) {
      logError("terms_sync_failed", err, { clientId: c.id });
    }
    if (!r) continue;
    out.updated += r.updated;
    out.manual += r.manual;
  }
  return out;
}

// Wersja „w tle” dla zapisów, które nie mogą się wywrócić przez przeliczenie.
export async function syncFutureRentalsToTermsSafe(clientId: string, actor: { userId: string }): Promise<TermsSyncResult | null> {
  try {
    return await syncFutureRentalsToTerms(clientId, actor);
  } catch (err) {
    logError("terms_sync_failed", err, { clientId });
    return null;
  }
}

// MCP rezerwacje_bez_kwoty: wszystkie przyszłe rezerwacje bez rozliczenia —
// z proponowaną kwotą (warunki klienta, a bez nich cennik ogólny) i źródłem.
export type WithoutAmountRow = {
  rentalId: string;
  title: string;
  startsAt: string;
  deviceName: string;
  days: number;
  clientId: string | null;
  clientName: string | null;
  clientHasPrices: boolean;
  plan: BackfillPlan | null; // null = rezerwacja bez klienta
  positions: string | null;
};

export async function loadRentalsWithoutAmount(today = new Date()): Promise<WithoutAmountRow[]> {
  const rentals = await prisma.rental.findMany({
    where: { deletedInGoogle: false, eventType: "WYNAJEM", startsAt: { gt: today }, finance: { is: null } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, description: true, startsAt: true, endsAt: true, clientId: true, device: { select: { name: true, pricingCategory: true, variantOptions: true } } },
  });
  const clientIds = [...new Set(rentals.map((r) => r.clientId).filter((x): x is string => !!x))];
  const [clients, priceRules, withTransport] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true, shortName: true, transportPriceNet: true, paymentForm: true, invoiceMode: true, invoicePartDefault: true, prices: { select: { device: true, days: true, priceNet: true } } },
    }),
    prisma.priceRule.findMany({ select: { pricingCategory: true, variant: true, durationDays: true, priceNet: true } }),
    // Dni, w które klient ma już rezerwację z transportem (1 kurs).
    prisma.rental.findMany({
      where: { deletedInGoogle: false, startsAt: { gt: today }, clientId: { in: clientIds }, finance: { transportPriceNet: { gt: 0 } } },
      select: { clientId: true, startsAt: true },
    }),
  ]);
  const byId = new Map(clients.map((c) => [c.id, c]));
  const priceList = priceRules.map((p) => ({ category: p.pricingCategory, variant: p.variant, days: p.durationDays, priceNet: Number(p.priceNet) }));
  const dayTaken = new Set(withTransport.map((r) => `${r.clientId}|${warsawYmd(r.startsAt)}`));
  return rentals.map((r) => {
    const c = r.clientId ? byId.get(r.clientId) : undefined;
    const days = rentalDurationDays(r.startsAt, r.endsAt);
    let plan: BackfillPlan | null = null;
    if (c) {
      const key = `${c.id}|${warsawYmd(r.startsAt)}`;
      const variantOptions = Array.isArray(r.device.variantOptions) ? (r.device.variantOptions as unknown[]).filter((v): v is string => typeof v === "string") : [];
      plan = planBackfill(
        { title: r.title, description: r.description, category: r.device.pricingCategory, variantOptions, days },
        {
          prices: c.prices.map((p) => ({ device: p.device, days: p.days, priceNet: Number(p.priceNet) })),
          transportNet: c.transportPriceNet != null ? Number(c.transportPriceNet) : null,
          paymentForm: c.paymentForm,
          invoiceMode: parseInvoiceMode(c.invoiceMode),
          invoicePartDefault: c.invoicePartDefault != null ? Number(c.invoicePartDefault) : null,
        },
        priceList,
        dayTaken.has(key),
      );
      if (plan.ready && plan.transportNet > 0) dayTaken.add(key);
    }
    return {
      rentalId: r.id,
      title: r.title,
      startsAt: r.startsAt.toISOString(),
      deviceName: r.device.name,
      days,
      clientId: c?.id ?? null,
      clientName: c ? (c.shortName ?? c.name) : null,
      clientHasPrices: !!c && c.prices.length > 0,
      plan,
      positions:
        plan?.ready
          ? positionsSummary({ eventType: "WYNAJEM", baseNet: plan.baseNet, transportNet: plan.transportNet, pulseSurchargeNet: null, pulsesPending: r.device.pricingCategory === "ALMA_HARMONY", capNet: null, membraneNet: null })
          : null,
    };
  });
}
