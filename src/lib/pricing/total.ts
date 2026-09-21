import type { Prisma, RentalEventType } from "./types";

// VAT transportu, gdy rozliczany osobno — zawsze 23% (decyzja biznesowa,
// nieedytowalne per-wydarzenie w odróżnieniu od VAT-u wynajmu).
export const TRANSPORT_VAT_RATE = 23;

export type TotalsInput = {
  eventType: RentalEventType;
  baseRentalPriceNet: Prisma.Decimal;
  pulseSurchargeNet: Prisma.Decimal | null; // tylko Alma
  transportPriceNet: Prisma.Decimal | null; // pomijany dla SZKOLENIE (spec 3.6)
  // true = transport poza sumą wynajmu, z własnym VAT-em i płatnością.
  transportPaidSeparately: boolean;
  transportVatApplicable: boolean; // tylko gdy transportPaidSeparately
  capUsedHS: boolean | null; // nakładka HS, tylko LightSheer "double"
  capCountHS?: number | null; // ile nakładek (domyślnie 1); suma = capFeeNet * count
  capFeeNet: Prisma.Decimal | null;
  membraneUsed: boolean | null; // membrany, tylko Cooltech
  membraneCount?: number | null; // ile membran (domyślnie 1); suma = membraneFeeNet * count
  membraneFeeNet: Prisma.Decimal | null;
  vatApplicable: boolean;
  vatRate: Prisma.Decimal; // w procentach, np. 23
};

export type TotalsResult = {
  // Suma WYNAJMU. Zawiera transport tylko gdy !transportPaidSeparately.
  totalNet: Prisma.Decimal;
  totalGross: Prisma.Decimal;
  // Suma TRANSPORTU — null gdy transport nie jest rozliczany osobno
  // (albo dla SZKOLENIA, które transportu nie ma).
  transportTotalNet: Prisma.Decimal | null;
  transportTotalGross: Prisma.Decimal | null;
};

// Suma końcowa (spec 3.5). Zawsze liczona server-side i zapisywana
// zdenormalizowana na RentalFinance — pod szybki widok kierowcy i pod
// przyszłe raportowanie SQL.
export function computeTotals(input: TotalsInput): TotalsResult {
  const isSzkolenie = input.eventType === "SZKOLENIE";
  const transportSeparate = input.transportPaidSeparately && !isSzkolenie;

  let net = input.baseRentalPriceNet;
  net = net.plus(input.pulseSurchargeNet ?? 0);
  if (!isSzkolenie && !transportSeparate) {
    net = net.plus(input.transportPriceNet ?? 0);
  }
  if (input.capUsedHS && input.capFeeNet) {
    const count = Math.max(1, Math.trunc(input.capCountHS ?? 1));
    net = net.plus(input.capFeeNet.times(count));
  }
  if (input.membraneUsed && input.membraneFeeNet) {
    const count = Math.max(1, Math.trunc(input.membraneCount ?? 1));
    net = net.plus(input.membraneFeeNet.times(count));
  }

  const totalNet = round2(net);
  const totalGross = input.vatApplicable
    ? round2(totalNet.times(input.vatRate.div(100).plus(1)))
    : totalNet;

  let transportTotalNet: Prisma.Decimal | null = null;
  let transportTotalGross: Prisma.Decimal | null = null;
  if (transportSeparate) {
    transportTotalNet = round2(input.transportPriceNet ?? zeroLike(input.baseRentalPriceNet));
    transportTotalGross = input.transportVatApplicable
      ? round2(transportTotalNet.times(1 + TRANSPORT_VAT_RATE / 100))
      : transportTotalNet;
  }

  return { totalNet, totalGross, transportTotalNet, transportTotalGross };
}

// Prisma.Decimal(0) bez importu wartości Prismy do tego pliku — bierzemy
// konstruktor z dowolnego istniejącego Decimala w wejściu.
function zeroLike(d: Prisma.Decimal): Prisma.Decimal {
  return d.minus(d);
}

// decimal.js ROUND_HALF_UP (= 4): do najbliższej wartości, przy połowie w górę
// (od zera). Podane liczbą zamiast Prisma.Decimal.ROUND_HALF_UP, żeby nie
// zależeć od tego, czy generowany typ Prismy wystawia tę stałą statyczną.
const ROUND_HALF_UP = 4;

export function round2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, ROUND_HALF_UP);
}
