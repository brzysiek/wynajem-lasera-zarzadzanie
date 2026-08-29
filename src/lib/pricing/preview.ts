// Podgląd kwot po stronie klienta (formularz wynajmu, panel kierowcy).
// Liczby zwykłe, nie Prisma.Decimal — to TYLKO podgląd; serwer przelicza
// autorytatywnie przez src/lib/pricing/index.ts przy zapisie. Import wyłącznie
// typu z @prisma/client, więc plik jest bezpieczny w bundlu przeglądarki.
import type { DevicePricingCategory } from "@prisma/client";
import { FLEX_VARIANT } from "./variants";

export type PreviewPriceRule = {
  pricingCategory: DevicePricingCategory;
  variant: string | null;
  durationDays: number;
  priceNet: number;
};

export type PreviewPulseTier = {
  durationDays: number;
  order: number;
  maxPulses: number | null;
  priceNet: number;
  isOverflowTier: boolean;
  overflowStepPulses: number | null;
  overflowStepPriceNet: number | null;
};

export type PreviewContext = {
  priceRules: PreviewPriceRule[];
  pulseTiers: PreviewPulseTier[];
};

export const FLEX_PLACEHOLDER_NET_NUMBER = 750;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Placeholder ceny flex przed odczytem liczników: najniższy próg z cennika
// dla danej liczby dni (fallback 750).
export function previewFlexPlaceholder(ctx: PreviewContext, durationDays: number): number {
  const relevant = ctx.pulseTiers.filter((t) => t.durationDays === durationDays && !t.isOverflowTier);
  if (relevant.length === 0) return FLEX_PLACEHOLDER_NET_NUMBER;
  return relevant.reduce((min, t) => (t.priceNet < min ? t.priceNet : min), relevant[0].priceNet);
}

// null = brak reguły w cenniku (biuro wpisze ręcznie).
export function previewBasePrice(
  ctx: PreviewContext,
  category: DevicePricingCategory | null,
  variant: string | null,
  durationDays: number,
): { priceNet: number | null; fromList: boolean; flexPlaceholder: boolean } {
  if (category === "LIGHTSHEER_VARIANT" && variant === FLEX_VARIANT) {
    return { priceNet: previewFlexPlaceholder(ctx, durationDays), fromList: false, flexPlaceholder: true };
  }
  if (!category) return { priceNet: null, fromList: false, flexPlaceholder: false };
  const rule = ctx.priceRules.find(
    (r) => r.pricingCategory === category && (r.variant ?? null) === (variant ?? null) && r.durationDays === durationDays,
  );
  return rule
    ? { priceNet: rule.priceNet, fromList: true, flexPlaceholder: false }
    : { priceNet: null, fromList: false, flexPlaceholder: false };
}

export function previewFlexPrice(ctx: PreviewContext, durationDays: number, pulsesUsed: number): number | null {
  const tiers = ctx.pulseTiers
    .filter((t) => t.durationDays === durationDays)
    .sort((a, b) => a.order - b.order);
  if (tiers.length === 0) return null;
  for (const t of tiers) {
    if (!t.isOverflowTier && (t.maxPulses === null || pulsesUsed <= t.maxPulses)) return t.priceNet;
  }
  const overflow = tiers[tiers.length - 1];
  if (!overflow.isOverflowTier || overflow.overflowStepPulses == null || overflow.overflowStepPriceNet == null) {
    return overflow.priceNet;
  }
  const lastFlat = [...tiers].reverse().find((t) => !t.isOverflowTier && t.maxPulses !== null);
  const baseline = lastFlat?.maxPulses ?? 0;
  const steps = Math.ceil(Math.max(0, pulsesUsed - baseline) / overflow.overflowStepPulses);
  return round2(overflow.priceNet + overflow.overflowStepPriceNet * steps);
}

export function previewTotals(input: {
  baseNet: number;
  pulseSurchargeNet: number | null;
  transportNet: number | null;
  capFeeNet: number | null;
  capUsed: boolean;
  vatApplicable: boolean;
  vatRate: number;
  isSzkolenie: boolean;
}): { net: number; gross: number } {
  let net = input.baseNet;
  net += input.pulseSurchargeNet ?? 0;
  if (!input.isSzkolenie) net += input.transportNet ?? 0;
  if (input.capUsed) net += input.capFeeNet ?? 0;
  net = round2(net);
  const gross = input.vatApplicable ? round2(net * (1 + input.vatRate / 100)) : net;
  return { net, gross };
}

export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!cleaned) return null;
  const n = Number(cleaned[0]);
  return Number.isFinite(n) ? n : null;
}
