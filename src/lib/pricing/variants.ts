// Etykiety i dozwolone warianty głowicy per kategoria cennika. Współdzielone
// przez konfigurację urządzenia (/urzadzenia), formularz wynajmu i walidację
// API. Import tylko typu z @prisma/client — plik jest bezpieczny do użycia w
// komponentach klienckich (żadnego runtime'u Prismy w bundlu przeglądarki).
import type { DevicePricingCategory } from "@prisma/client";

// Klucze wariantów głowicy używane w kodzie (Device.variantOptions,
// RentalFinance.deviceVariant). Trzymane tu, w module client-safe.
export const FLEX_VARIANT = "single_flex";
export const DOUBLE_VARIANT = "double";

export const PRICING_CATEGORY_LABELS: Record<DevicePricingCategory, string> = {
  LIGHTSHEER_VARIANT: "LightSheer (DESIRE / LIGHT / QUATTRO)",
  LIGHTSHEER_ET400_FLAT: "LightSheer ET400 (cena stała)",
  ALMA_HARMONY: "Alma Harmony XL Pro",
  COOLTECH_FLAT: "Cooltech (cena stała)",
  RESURFX_FLAT: "ResurFX (cena stała)",
  OBSERV_FLAT: "Observ (cena stała)",
};

export const PRICING_CATEGORY_VALUES = Object.keys(PRICING_CATEGORY_LABELS) as DevicePricingCategory[];

export const VARIANT_OPTIONS_BY_CATEGORY: Record<DevicePricingCategory, { value: string; label: string }[]> = {
  LIGHTSHEER_VARIANT: [
    { value: "single_standard", label: "Pojedyncza głowica — standard" },
    { value: "single_flex", label: "Pojedyncza głowica — elastyczna (impulsy)" },
    { value: "double", label: "Podwójna głowica" },
  ],
  ALMA_HARMONY: [
    { value: "dye_vl", label: "Dye-VL" },
    { value: "dye_vl_ipixel", label: "Dye-VL + Er:YAG iPixel" },
  ],
  LIGHTSHEER_ET400_FLAT: [],
  COOLTECH_FLAT: [],
  RESURFX_FLAT: [],
  OBSERV_FLAT: [],
};

export function categoryHasVariants(category: DevicePricingCategory): boolean {
  return VARIANT_OPTIONS_BY_CATEGORY[category].length > 0;
}

export function isAllowedVariant(category: DevicePricingCategory, variant: string): boolean {
  return VARIANT_OPTIONS_BY_CATEGORY[category].some((o) => o.value === variant);
}

export function variantLabel(category: DevicePricingCategory | null, variant: string | null): string {
  if (!category || !variant) return "";
  return VARIANT_OPTIONS_BY_CATEGORY[category].find((o) => o.value === variant)?.label ?? variant;
}

// Krótka etykieta wariantu wg samego klucza (klucze są globalnie unikalne
// między kategoriami) — do nagłówków i podsumowań, gdzie nie mamy pod ręką
// kategorii. Pusty string dla braku wariantu (ET400, Cooltech, ResurFX,
// Observ), żeby wołający mógł po prostu pominąć fragment.
export const VARIANT_LABELS: Record<string, string> = {
  single_standard: "pojedyncza głowica",
  single_flex: "pojedyncza głowica — elastyczna (impulsy)",
  double: "podwójna głowica",
  dye_vl: "Dye-VL",
  dye_vl_ipixel: "Dye-VL + Er:YAG iPixel",
};

export function variantShortLabel(variant: string | null | undefined): string {
  if (!variant) return "";
  return VARIANT_LABELS[variant] ?? variant;
}
