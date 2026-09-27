// Jednorazowe uzupełnienie kwot (karta klienta, etap D): przyszłe rezerwacje
// bez rozliczenia u klientów z warunkami (tabela cen) — co podstawić, a czego
// nie da się ustalić. Plus porównanie wpisanych kwot z warunkami. Czysty moduł.
import type { DevicePricingCategory } from "@prisma/client";
import { headsFromText } from "./rhythm";
import { clientPriceFor, deviceCodeFor, invoiceDefaults, termsDeviation, type ClientPriceRow, type InvoiceMode, type TermsDeviceCode } from "./terms-rules";

export type PlanTerms = {
  prices: ClientPriceRow[];
  transportNet: number | null;
  paymentForm: string | null;
  invoiceMode: InvoiceMode | null;
  invoicePartDefault: number | null;
};

export type PlanRental = {
  title: string;
  description: string | null;
  category: DevicePricingCategory | null;
  variantOptions: string[];
  days: number;
};

export type BackfillPlan =
  | {
      ready: true;
      variant: string | null;
      code: TermsDeviceCode | null;
      baseNet: number;
      baseSource: "CLIENT_TERMS" | "PRICE_LIST";
      transportNet: number;
      vatApplicable: boolean;
      invoicePart: number | null;
      paymentMethod: "CASH" | "TRANSFER";
      totalNet: number;
    }
  | { ready: false; reason: string };

const LS_CODES: Record<string, string> = { LS_1G: "single_standard", LS_2G: "double" };
const ALMA_CODES: Record<string, string> = { ALMA_DYEVL: "dye_vl", ALMA_DYEVL_IPIXEL: "dye_vl_ipixel", ALMA_IPIXEL: "er_yag_ipixel" };

// Wariant głowicy: z tytułu („2 głowice”), a bez tego — jedyny wariant tej
// kategorii w cenach klienta.
export function resolveVariant(r: PlanRental, prices: ClientPriceRow[]): { variant: string | null } | { reason: string } {
  if (r.category === "LIGHTSHEER_VARIANT") {
    const heads = headsFromText(`${r.title} ${r.description ?? ""}`);
    if (heads === 2) return { variant: "double" };
    if (heads === 1) return { variant: "single_standard" };
    const own = [...new Set(prices.map((p) => LS_CODES[p.device]).filter(Boolean))];
    if (own.length === 1) return { variant: own[0] };
    return { reason: "nie wiadomo, 1 czy 2 głowice — uzupełnij w rezerwacji" };
  }
  if (r.category === "ALMA_HARMONY") {
    const own = [...new Set(prices.map((p) => ALMA_CODES[p.device]).filter(Boolean))];
    if (own.length === 1) return { variant: own[0] };
    if (r.variantOptions.length === 1) return { variant: r.variantOptions[0] };
    return { reason: "nie wiadomo, który wariant Almy — uzupełnij w rezerwacji" };
  }
  if (!r.category) return { reason: "urządzenie bez kategorii cennika (Urządzenia)" };
  return { variant: null };
}

export function planBackfill(
  r: PlanRental,
  terms: PlanTerms,
  priceList: { category: DevicePricingCategory; variant: string | null; days: number; priceNet: number }[],
  transportTaken: boolean,
): BackfillPlan {
  const v = resolveVariant(r, terms.prices);
  if ("reason" in v) return { ready: false, reason: v.reason };
  const code = deviceCodeFor("WYNAJEM", r.category, v.variant);
  const own = clientPriceFor(terms.prices, code, r.days);
  const list = priceList.find((p) => p.category === r.category && (p.variant ?? null) === (v.variant ?? null) && p.days === r.days)?.priceNet ?? null;
  const baseNet = own ?? list;
  if (baseNet == null) return { ready: false, reason: `brak ceny dla ${r.days} ${r.days === 1 ? "dnia" : "dni"} (ani w warunkach, ani w cenniku)` };
  const transportNet = transportTaken ? 0 : (terms.transportNet ?? 0);
  const inv = invoiceDefaults(terms.invoiceMode, terms.invoicePartDefault) ?? { vatApplicable: false, invoiceNet: null };
  return {
    ready: true,
    variant: v.variant,
    code,
    baseNet,
    baseSource: own != null ? "CLIENT_TERMS" : "PRICE_LIST",
    transportNet,
    vatApplicable: inv.vatApplicable,
    invoicePart: inv.invoiceNet,
    paymentMethod: terms.paymentForm === "PRZELEW" ? "TRANSFER" : "CASH",
    totalNet: Math.round((baseNet + transportNet) * 100) / 100,
  };
}

// Wpisana kwota vs warunki: cena wynajmu (tylko gdy klient ma cenę dla tego
// urządzenia i liczby dni) i transport (0 przy drugim urządzeniu tego dnia).
export function compareWithTerms(
  actual: { baseNet: number; transportNet: number | null; code: TermsDeviceCode | null; days: number },
  terms: PlanTerms,
  transportTakenByOther: boolean,
): { base: { expected: number; pct: number } | null; transport: { expected: number } | null; big: boolean } | null {
  const expectedBase = clientPriceFor(terms.prices, actual.code, actual.days);
  const base = expectedBase != null && Math.abs(actual.baseNet - expectedBase) >= 0.01 ? { expected: expectedBase, pct: (actual.baseNet - expectedBase) / expectedBase } : null;
  const expectedTransport = terms.transportNet == null ? null : transportTakenByOther ? 0 : terms.transportNet;
  const transport = expectedTransport != null && Math.abs((actual.transportNet ?? 0) - expectedTransport) >= 0.01 ? { expected: expectedTransport } : null;
  if (!base && !transport) return null;
  return { base, transport, big: !!(base && termsDeviation(actual.baseNet, expectedBase)) };
}
