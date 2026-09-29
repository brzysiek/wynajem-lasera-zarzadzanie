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
export const PRICE_SOURCES = ["MAIL", "ROZMOWA", "OFERTA", "UMOWA", "USTALENIE", "REZERWACJA", "HISTORIA", "AGENT"] as const;
export const PRICE_SOURCE_LABEL: Record<string, string> = {
  MAIL: "mail",
  ROZMOWA: "rozmowa",
  OFERTA: "oferta",
  UMOWA: "umowa",
  USTALENIE: "ustalenie",
  REZERWACJA: "z rezerwacji",
  HISTORIA: "z historii",
  AGENT: "agent",
};

// Wniosek 28: transport ustalony — źródło kwoty.
export const TRANSPORT_SOURCE_LABEL = {
  DOTYCHCZASOWA: "dotychczasowa kwota",
  USTALONE: "ustalone",
  REZERWACJA: "z rezerwacji",
  AGENT: "propozycja agenta",
} as const;
export type TransportSourceKey = keyof typeof TRANSPORT_SOURCE_LABEL;
export const TRANSPORT_SOURCE_KEYS = Object.keys(TRANSPORT_SOURCE_LABEL) as TransportSourceKey[];
// Sugestia z km odbiega od ustalonej kwoty o więcej niż 20% → „do przejrzenia”.
export const TRANSPORT_REVIEW_DEVIATION = 0.2;
export function transportNeedsReview(fixed: number | null, suggested: number | null): boolean {
  if (fixed == null || suggested == null || suggested <= 0) return false;
  return Math.abs(fixed - suggested) / suggested > TRANSPORT_REVIEW_DEVIATION;
}

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

// Kody z tabeli klienta w danej kategorii cennika (np. LightSheer: LS_1G / LS_2G).
export function clientCodesInCategory(prices: ClientPriceRow[], category: DevicePricingCategory | null): TermsDeviceCode[] {
  if (!category) return [];
  return [...new Set(prices.map((p) => p.device))].filter(isTermsDevice).filter((c) => TERMS_DEVICES.find((d) => d.code === c)?.category === category);
}

// Jedyny wariant tej kategorii w tabeli klienta (wniosek 17, pkt 3) — null,
// gdy klient ma kilka albo żadnego.
export function clientOnlyVariant(prices: ClientPriceRow[], category: DevicePricingCategory | null): { code: TermsDeviceCode; variant: string | null } | null {
  const codes = clientCodesInCategory(prices, category);
  if (codes.length !== 1) return null;
  return { code: codes[0], variant: TERMS_DEVICES.find((d) => d.code === codes[0])!.variant };
}

// Cena z warunków do porównania z rezerwacją: ten sam wariant, a gdy klient
// ma w tabeli tylko inny wariant tego urządzenia — ten (wniosek 17, pkt 2:
// Estetic, rezerwacja „2 głowice” z cennika, klient ma tylko LS 1 głowica).
// Taryfa elastyczna (impulsy) — bez porównania.
export function expectedClientPrice(
  prices: ClientPriceRow[],
  eventType: "WYNAJEM" | "SZKOLENIE",
  category: DevicePricingCategory | null,
  variant: string | null,
  days: number,
): { priceNet: number; code: TermsDeviceCode; otherVariant: boolean } | null {
  const code = deviceCodeFor(eventType, category, variant);
  const own = clientPriceFor(prices, code, days);
  if (own != null) return { priceNet: own, code: code!, otherVariant: false };
  if (eventType === "SZKOLENIE" || variant === "single_flex") return null;
  const only = clientOnlyVariant(prices, category);
  if (!only || only.code === code) return null;
  const p = clientPriceFor(prices, only.code, days);
  return p != null ? { priceNet: p, code: only.code, otherVariant: true } : null;
}

// Wariant do rozliczenia rezerwacji już policzonej (nie ręcznie): Alma — gdy
// obecny wariant nie ma ceny klienta, a klient ma w tabeli jeden wariant Almy
// z ceną na tyle dni (Pawlik: z cennika „iPixel”, w warunkach Dye-VL + iPixel).
// LightSheer bez zmian — 1 czy 2 głowice to decyzja przy rezerwacji, różnica
// trafia na listę rozbieżności.
export function termsVariantFor(category: DevicePricingCategory | null, current: string | null, variantOptions: string[], prices: ClientPriceRow[], days: number): string | null {
  if (category !== "ALMA_HARMONY") return current;
  if (clientPriceFor(prices, deviceCodeFor("WYNAJEM", category, current), days) != null) return current;
  const only = clientOnlyVariant(prices, category);
  if (!only?.variant || only.variant === current) return current;
  if (variantOptions.length && !variantOptions.includes(only.variant)) return current;
  return clientPriceFor(prices, only.code, days) != null ? only.variant : current;
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

// Domyślne ustawienia faktury rezerwacji wg warunków klienta. „Część” bez
// ustalonej kwoty: VAT tak, kwota na FV do ustalenia (pending) — nie
// zgadujemy całości (wniosek 17, pkt 1: Kolber, Garcia).
export type InvoiceDefaults = { vatApplicable: boolean; invoiceNet: number | null; pending: boolean };

export function invoiceDefaults(mode: InvoiceMode | null, partDefault: number | null): InvoiceDefaults | null {
  if (mode === "NONE") return { vatApplicable: false, invoiceNet: null, pending: false };
  if (mode === "FULL") return { vatApplicable: true, invoiceNet: null, pending: false };
  if (mode === "PARTIAL") return partDefault != null ? { vatApplicable: true, invoiceNet: partDefault, pending: false } : { vatApplicable: true, invoiceNet: null, pending: true };
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

// Wniosek 28: źródło ceny wynajmu — do znacznika w rezerwacji (dymek) i MCP
// kalendarz_wynajmy. Rozróżnia „wyjątek klienta” i „cennik, bo brak wyjątku
// na tę liczbę dni”.
export function priceSourceDetail(input: {
  source: "PRICE_LIST" | "CLIENT_TERMS" | "MANUAL" | "PULSE_CALCULATED" | null;
  days: number;
  clientHasPrices: boolean;
  overrideNote?: string | null;
  termsSince?: string | Date | null;
}): { tag: "cennik" | "indywidualne" | "ręcznie" | "impulsy"; text: string } | null {
  const dni = `${input.days} ${input.days === 1 ? "dzień" : "dni"}`;
  const since = input.termsSince ? new Date(input.termsSince).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Warsaw" }) : null;
  switch (input.source) {
    case "CLIENT_TERMS":
      return { tag: "indywidualne", text: `wyjątek klienta${since ? ` od ${since}` : ""}` };
    case "PRICE_LIST":
      return { tag: "cennik", text: input.clientHasPrices ? `cennik (brak wyjątku na ${dni})` : "cennik" };
    case "MANUAL":
      return { tag: "ręcznie", text: `ręcznie${input.overrideNote ? `: ${input.overrideNote}` : ""}` };
    case "PULSE_CALCULATED":
      return { tag: "impulsy", text: "z impulsów" };
    default:
      return null;
  }
}
