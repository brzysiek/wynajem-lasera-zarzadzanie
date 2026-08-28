// Ładowanie kontekstu cennika z bazy i drobne konwersje na potrzeby
// src/lib/pricing/. Współdzielone przez endpoint kierowcy (Faza 2) i sekcję
// „Finanse" w formularzu wynajmu (Faza 3).
import {
  Prisma,
  type DevicePricingCategory,
  type PaymentMethod,
  type PriceSource,
  type PulseCalculationStatus,
  type RentalEventType,
  type RentalFinance,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DOUBLE_VARIANT,
  FLEX_PLACEHOLDER_NET,
  FLEX_VARIANT,
  rentalDurationDays,
  recalculateFinance,
  resolveBasePrice,
  variantNeedsPulseCounters,
  type PricingContext,
  type PricingSettings,
} from "@/lib/pricing";
import { isAllowedVariant } from "@/lib/pricing/variants";
import type { PreviewPriceRule, PreviewPulseTier } from "@/lib/pricing/preview";

const SETTING_FALLBACKS: Record<keyof PricingSettings, { key: string; value: number }> = {
  capFeeHsNet: { key: "cap_fee_hs_net", value: 70 },
  vatRateDefault: { key: "vat_rate_default", value: 23 },
  almaPulseRateNet: { key: "alma_pulse_rate_net", value: 0.06 },
};

// Pojedyncze wartości cennika. Fallbacki na wypadek braku wiersza (seed
// migracji je wgrywa, ale nie zakładamy tego twardo).
export async function loadPricingSettings(): Promise<PricingSettings> {
  const rows = await prisma.pricingSetting.findMany();
  const read = (name: keyof PricingSettings): Prisma.Decimal => {
    const cfg = SETTING_FALLBACKS[name];
    const row = rows.find((r) => r.key === cfg.key);
    return row ? row.value : new Prisma.Decimal(cfg.value);
  };
  return {
    capFeeHsNet: read("capFeeHsNet"),
    vatRateDefault: read("vatRateDefault"),
    almaPulseRateNet: read("almaPulseRateNet"),
  };
}

type RentalForPricingContext = {
  eventType: RentalEventType;
  startsAt: Date;
  endsAt: Date;
  device: { pricingCategory: DevicePricingCategory | null };
  finance: { deviceVariant: string | null } | null;
};

// Składa PricingContext dla jednego wydarzenia: kategoria z urządzenia,
// wybrany wariant z RentalFinance (jeśli już jest), reguły/progi ograniczone
// do tej kategorii + pojedyncze wartości.
export async function loadPricingContext(rental: RentalForPricingContext): Promise<PricingContext> {
  const pricingCategory = rental.device.pricingCategory;

  const [priceRules, pulseTiers, settings] = await Promise.all([
    pricingCategory ? prisma.priceRule.findMany({ where: { pricingCategory } }) : Promise.resolve([]),
    pricingCategory ? prisma.pulseTier.findMany({ where: { pricingCategory } }) : Promise.resolve([]),
    loadPricingSettings(),
  ]);

  return {
    eventType: rental.eventType,
    pricingCategory,
    deviceVariant: rental.finance?.deviceVariant ?? null,
    durationDays: rentalDurationDays(rental.startsAt, rental.endsAt),
    priceRules,
    pulseTiers,
    settings,
  };
}

// rental.transportPrice to wolny tekst ("500 zł", "150 netto/km", "do
// uzgodnienia"). Do sumy netto bierzemy pierwszą liczbę z tekstu; wartości
// bez liczby ("do uzgodnienia") nie dokładają nic (null → 0 w computeTotals).
export function parseTransportPrice(raw: string | null | undefined): Prisma.Decimal | null {
  if (!raw) return null;
  const match = raw.replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  try {
    return new Prisma.Decimal(match[0]);
  } catch {
    return null;
  }
}

// Kontekst dla sekcji „Finanse" w formularzu wynajmu: cały cennik (małe
// tabele) w postaci liczb do podglądu client-side + domyślna stawka VAT.
export async function loadFinanceFormContext(): Promise<{
  previewPriceRules: PreviewPriceRule[];
  previewPulseTiers: PreviewPulseTier[];
  defaultVatRate: number;
  capFeeHsNet: number;
  almaPulseRateNet: number;
}> {
  const [rules, tiers, settings] = await Promise.all([
    prisma.priceRule.findMany(),
    prisma.pulseTier.findMany(),
    loadPricingSettings(),
  ]);
  return {
    capFeeHsNet: settings.capFeeHsNet.toNumber(),
    almaPulseRateNet: settings.almaPulseRateNet.toNumber(),
    previewPriceRules: rules.map(
      (r): PreviewPriceRule => ({
        pricingCategory: r.pricingCategory,
        variant: r.variant,
        durationDays: r.durationDays,
        priceNet: r.priceNet.toNumber(),
      }),
    ),
    previewPulseTiers: tiers.map(
      (t): PreviewPulseTier => ({
        durationDays: t.durationDays,
        order: t.order,
        maxPulses: t.maxPulses,
        priceNet: t.priceNet.toNumber(),
        isOverflowTier: t.isOverflowTier,
        overflowStepPulses: t.overflowStepPulses,
        overflowStepPriceNet: t.overflowStepPriceNet ? t.overflowStepPriceNet.toNumber() : null,
      }),
    ),
    defaultVatRate: settings.vatRateDefault.toNumber(),
  };
}

// Kwota z pola formularza (string/number). null = puste/niepoprawne/ujemne.
export function parseDecimalInput(raw: unknown): Prisma.Decimal | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const d = new Prisma.Decimal(typeof raw === "string" ? raw.replace(/\s/g, "").replace(",", ".") : (raw as number));
    if (!d.isFinite() || d.isNegative()) return null;
    return d;
  } catch {
    return null;
  }
}

// --- serializacja RentalFinance dla klienta (Decimal → string) ---
export type RentalFinanceDto = {
  deviceVariant: string | null;
  baseRentalPriceNet: string;
  baseRentalPriceSource: PriceSource;
  baseRentalPriceOverrideNote: string | null;
  pulseCounterStart: number | null;
  pulseCounterEnd: number | null;
  pulseCalculationStatus: PulseCalculationStatus | null;
  pulseSurchargeNet: string | null;
  capUsedHS: boolean | null;
  capFeeNet: string | null;
  vatApplicable: boolean;
  vatRate: string;
  totalNet: string;
  totalGross: string;
  paymentMethod: PaymentMethod;
  cashCollected: boolean | null;
};

export function financeDto(row: RentalFinance | null): RentalFinanceDto | null {
  if (!row) return null;
  return {
    deviceVariant: row.deviceVariant,
    baseRentalPriceNet: row.baseRentalPriceNet.toString(),
    baseRentalPriceSource: row.baseRentalPriceSource,
    baseRentalPriceOverrideNote: row.baseRentalPriceOverrideNote,
    pulseCounterStart: row.pulseCounterStart,
    pulseCounterEnd: row.pulseCounterEnd,
    pulseCalculationStatus: row.pulseCalculationStatus,
    pulseSurchargeNet: row.pulseSurchargeNet ? row.pulseSurchargeNet.toString() : null,
    capUsedHS: row.capUsedHS,
    capFeeNet: row.capFeeNet ? row.capFeeNet.toString() : null,
    vatApplicable: row.vatApplicable,
    vatRate: row.vatRate.toString(),
    totalNet: row.totalNet.toString(),
    totalGross: row.totalGross.toString(),
    paymentMethod: row.paymentMethod,
    cashCollected: row.cashCollected,
  };
}

// --- zapis finansów przez biuro (POST/PATCH /api/rentals) ---
export type OfficeFinanceInput = {
  deviceVariant: string | null;
  // present = ręczne nadpisanie ceny bazowej (dla single_flex ignorowane)
  baseRentalPriceNet?: string | number | null;
  baseRentalPriceOverrideNote?: string | null;
  vatApplicable: boolean;
  vatRate?: string | number | null;
  paymentMethod: "CASH" | "TRANSFER";
};

type RentalForFinanceSave = {
  id: string;
  eventType: RentalEventType;
  startsAt: Date;
  endsAt: Date;
  transportPrice: string | null;
  device: { pricingCategory: DevicePricingCategory | null };
  finance: RentalFinance | null;
};

// Liczy i zapisuje RentalFinance na podstawie danych biura. Pola kierowcy
// (liczniki, nakładka, gotówka) NIE są tu ruszane — poza wyzerowaniem tych,
// które nie pasują do nowego wariantu (spec 3.2–3.4). Zwraca komunikat 400
// gdy brakuje ceny, której nie da się dobrać z cennika.
export async function saveRentalFinance(
  rental: RentalForFinanceSave,
  input: OfficeFinanceInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const settings = await loadPricingSettings();
  const ctx = await loadPricingContext({ ...rental, finance: { deviceVariant: input.deviceVariant } });

  const isSzkolenie = rental.eventType === "SZKOLENIE";
  const variant = isSzkolenie ? null : input.deviceVariant;

  if (variant && (!ctx.pricingCategory || !isAllowedVariant(ctx.pricingCategory, variant))) {
    return { ok: false, message: "Wybrany wariant głowicy nie pasuje do kategorii cennika urządzenia." };
  }

  const isFlex = !isSzkolenie && ctx.pricingCategory === "LIGHTSHEER_VARIANT" && variant === FLEX_VARIANT;
  const isDouble = !isSzkolenie && variant === DOUBLE_VARIANT;
  const needsCounters = !isSzkolenie && variantNeedsPulseCounters(ctx.pricingCategory, variant);
  const existing = rental.finance;

  let baseRentalPriceNet: Prisma.Decimal;
  let baseRentalPriceSource: PriceSource;
  let overrideNote: string | null = null;

  const manual = parseDecimalInput(input.baseRentalPriceNet);

  if (isFlex) {
    // Taryfa elastyczna — cena bazowa zawsze z placeholdera/liczników, biuro
    // nie może jej nadpisać. recalculateFinance ją finalizuje.
    baseRentalPriceNet = FLEX_PLACEHOLDER_NET;
    baseRentalPriceSource = "MANUAL";
  } else if (manual != null) {
    baseRentalPriceNet = manual;
    baseRentalPriceSource = "MANUAL";
    overrideNote = input.baseRentalPriceOverrideNote?.trim() || null;
  } else {
    const resolved = resolveBasePrice({
      eventType: rental.eventType,
      pricingCategory: ctx.pricingCategory,
      deviceVariant: variant,
      durationDays: ctx.durationDays,
      priceRules: ctx.priceRules,
    });
    if (resolved.priceNet == null) {
      return {
        ok: false,
        message: isSzkolenie
          ? "Wpisz ustaloną cenę szkolenia."
          : "To urządzenie / ten okres nie ma ceny w cenniku — wpisz cenę wynajmu ręcznie.",
      };
    }
    baseRentalPriceNet = resolved.priceNet;
    baseRentalPriceSource = resolved.source;
  }

  const vatRate = parseDecimalInput(input.vatRate) ?? settings.vatRateDefault;

  const pulseCounterStart = needsCounters ? existing?.pulseCounterStart ?? null : null;
  const pulseCounterEnd = needsCounters ? existing?.pulseCounterEnd ?? null : null;
  const capUsedHS = isDouble ? existing?.capUsedHS ?? null : null;
  const capFeeNet = isDouble ? existing?.capFeeNet ?? null : null;

  const computed = recalculateFinance(
    { ...ctx, deviceVariant: variant },
    {
      baseRentalPriceNet,
      baseRentalPriceSource,
      pulseCounterStart,
      pulseCounterEnd,
      capUsedHS,
      capFeeNet,
      vatApplicable: Boolean(input.vatApplicable),
      vatRate,
      transportPrice: parseTransportPrice(rental.transportPrice),
    },
  );

  const data = {
    deviceVariant: variant,
    baseRentalPriceNet: computed.baseRentalPriceNet,
    baseRentalPriceSource: computed.baseRentalPriceSource,
    baseRentalPriceOverrideNote: overrideNote,
    pulseCounterStart,
    pulseCounterEnd,
    pulseCalculationStatus: computed.pulseCalculationStatus,
    pulseSurchargeNet: computed.pulseSurchargeNet,
    capUsedHS,
    capFeeNet,
    vatApplicable: Boolean(input.vatApplicable),
    vatRate,
    totalNet: computed.totalNet,
    totalGross: computed.totalGross,
    paymentMethod: (input.paymentMethod === "TRANSFER" ? "TRANSFER" : "CASH") as PaymentMethod,
  };

  await prisma.rentalFinance.upsert({
    where: { rentalId: rental.id },
    create: { rentalId: rental.id, ...data, cashCollected: existing?.cashCollected ?? null },
    update: data,
  });

  return { ok: true };
}
