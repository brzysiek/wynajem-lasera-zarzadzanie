// Warunki handlowe klienta (karta klienta, etap C): kody urządzeń tabeli cen
// klienta ↔ kategorie cennika ogólnego, cena klienta vs cennik, kwota na
// fakturę, odchylenie od warunków, skrót pozycji rozliczenia. Czysty moduł
// (vitest bez "@/"; tylko typy z @prisma/client).
import type { DevicePricingCategory } from "@prisma/client";

export type TermsDeviceCode =
  | "LS_1G"
  | "LS_2G"
  | "ET400"
  | "ALMA_DYEVL"
  | "ALMA_DYEVL_IPIXEL"
  | "ALMA_IPIXEL"
  | "COOLTECH"
  | "RESURFX"
  | "OBSERV"
  | "SZKOLENIE";

// Kolejność = kolejność wierszy w tabeli na karcie.
export const TERMS_DEVICES: { code: TermsDeviceCode; label: string; category: DevicePricingCategory | null; variant: string | null }[] = [
  { code: "LS_1G", label: "LightSheer 1 głowica", category: "LIGHTSHEER_VARIANT", variant: "single_standard" },
  { code: "LS_2G", label: "LightSheer 2 głowice", category: "LIGHTSHEER_VARIANT", variant: "double" },
  { code: "ET400", label: "LightSheer ET400", category: "LIGHTSHEER_ET400_FLAT", variant: null },
  { code: "ALMA_DYEVL", label: "Alma Dye-VL", category: "ALMA_HARMONY", variant: "dye_vl" },
  { code: "ALMA_DYEVL_IPIXEL", label: "Alma Dye-VL + iPixel", category: "ALMA_HARMONY", variant: "dye_vl_ipixel" },
  { code: "ALMA_IPIXEL", label: "Alma iPixel", category: "ALMA_HARMONY", variant: "er_yag_ipixel" },
  { code: "COOLTECH", label: "Cooltech", category: "COOLTECH_FLAT", variant: null },
  { code: "RESURFX", label: "ResurFX", category: "RESURFX_FLAT", variant: null },
  { code: "OBSERV", label: "Observ", category: "OBSERV_FLAT", variant: null },
  { code: "SZKOLENIE", label: "Szkolenie", category: null, variant: null },
];

export const TERMS_DEVICE_LABEL = Object.fromEntries(TERMS_DEVICES.map((d) => [d.code, d.label])) as Record<TermsDeviceCode, string>;
export const TERMS_DAYS = [1, 2, 3, 7] as const;
export const PRICE_SOURCES = ["OFERTA", "UMOWA", "USTALENIE", "HISTORIA", "AGENT"] as const;
export const PRICE_SOURCE_LABEL: Record<string, string> = { OFERTA: "oferta", UMOWA: "umowa", USTALENIE: "ustalenie", HISTORIA: "z historii", AGENT: "agent" };

export function isTermsDevice(code: unknown): code is TermsDeviceCode {
  return typeof code === "string" && TERMS_DEVICES.some((d) => d.code === code);
}

// Urządzenie + wariant rozliczenia → kod tabeli cen. LightSheer „elastyczna”
// liczy się z impulsów — bez ceny klienta (null).
export function deviceCodeFor(eventType: "WYNAJEM" | "SZKOLENIE", category: DevicePricingCategory | null, variant: string | null): TermsDeviceCode | null {
  if (eventType === "SZKOLENIE") return "SZKOLENIE";
  if (!category) return null;
  const hit = TERMS_DEVICES.find((d) => d.category === category && (d.variant ?? null) === (variant ?? null));
  return hit?.code ?? null;
}

export type ClientPriceRow = { device: string; days: number; priceNet: number };

export function clientPriceFor(prices: ClientPriceRow[], code: TermsDeviceCode | null, days: number): number | null {
  if (!code) return null;
  return prices.find((p) => p.device === code && p.days === days)?.priceNet ?? null;
}

// ------------------------------------------------------------------ faktura

export type InvoiceMode = "FULL" | "PARTIAL" | "NONE";
export const INVOICE_MODE_LABEL: Record<InvoiceMode, string> = { FULL: "całość", PARTIAL: "część", NONE: "bez FV" };

export function parseInvoiceMode(v: unknown): InvoiceMode | null {
  return v === "FULL" || v === "PARTIAL" || v === "NONE" ? v : null;
}

// Kwota netto na fakturze wynajmu: bez VAT — 0; z VAT — część (invoiceNet),
// a bez części — całość.
export function invoiceNetOf(f: { vatApplicable: boolean; invoiceNet: number | null; totalNet: number }): number {
  if (!f.vatApplicable) return 0;
  return f.invoiceNet != null && f.invoiceNet < f.totalNet ? f.invoiceNet : f.totalNet;
}

// Domyślne ustawienia faktury nowej rezerwacji wg warunków klienta.
export function invoiceDefaults(mode: InvoiceMode | null, partDefault: number | null): { vatApplicable: boolean; invoiceNet: number | null } | null {
  if (mode === "NONE") return { vatApplicable: false, invoiceNet: null };
  if (mode === "FULL") return { vatApplicable: true, invoiceNet: null };
  if (mode === "PARTIAL") return { vatApplicable: true, invoiceNet: partDefault };
  return null;
}

// ------------------------------------------------------------------ odchylenie

export const TERMS_DEVIATION = 0.1;

// Różnica ceny wynajmu względem warunków klienta; null = w granicach 10%
// albo brak warunków do porównania.
export function termsDeviation(actual: number, expected: number | null): { pct: number; expected: number } | null {
  if (expected == null || expected <= 0) return null;
  const pct = (actual - expected) / expected;
  return Math.abs(pct) > TERMS_DEVIATION + 1e-9 ? { pct, expected } : null;
}

// ------------------------------------------------------------------ pozycje

export type PositionsInput = {
  eventType: "WYNAJEM" | "SZKOLENIE";
  baseNet: number;
  transportNet: number | null;
  pulseSurchargeNet: number | null;
  pulsesPending: boolean; // impulsy do policzenia po odbiorze
  capNet: number | null;
  membraneNet: number | null;
};

const zl = (n: number) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2, useGrouping: false }).format(n);

// „wynajem 1200 · transport 70 · impulsy po odbiorze” (kwoty bez spacji, jak we wzorze)
export function positionsSummary(p: PositionsInput): string {
  const parts = [`${p.eventType === "SZKOLENIE" ? "szkolenie" : "wynajem"} ${zl(p.baseNet)}`];
  if (p.transportNet) parts.push(`transport ${zl(p.transportNet)}`);
  if (p.pulseSurchargeNet) parts.push(`impulsy ${zl(p.pulseSurchargeNet)}`);
  else if (p.pulsesPending) parts.push("impulsy po odbiorze");
  if (p.capNet) parts.push(`nakładka ${zl(p.capNet)}`);
  if (p.membraneNet) parts.push(`membrana ${zl(p.membraneNet)}`);
  return parts.join(" · ");
}
