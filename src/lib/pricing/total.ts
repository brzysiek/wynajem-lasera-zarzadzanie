import type { Prisma, RentalEventType } from "./types";

export type TotalsInput = {
  eventType: RentalEventType;
  baseRentalPriceNet: Prisma.Decimal;
  pulseSurchargeNet: Prisma.Decimal | null; // tylko Alma
  transportPrice: Prisma.Decimal | null; // pomijany dla SZKOLENIE (spec 3.6)
  capUsedHS: boolean | null; // nakładka HS, tylko LightSheer "double"
  capFeeNet: Prisma.Decimal | null;
  vatApplicable: boolean;
  vatRate: Prisma.Decimal; // w procentach, np. 23
};

// Suma końcowa (spec 3.5). Zawsze liczona server-side i zapisywana
// zdenormalizowana na RentalFinance — pod szybki widok kierowcy i pod
// przyszłe raportowanie SQL.
export function computeTotals(input: TotalsInput): {
  totalNet: Prisma.Decimal;
  totalGross: Prisma.Decimal;
} {
  let net = input.baseRentalPriceNet;
  net = net.plus(input.pulseSurchargeNet ?? 0);
  if (input.eventType !== "SZKOLENIE") {
    net = net.plus(input.transportPrice ?? 0);
  }
  if (input.capUsedHS) {
    net = net.plus(input.capFeeNet ?? 0);
  }

  const totalNet = round2(net);
  const totalGross = input.vatApplicable
    ? round2(totalNet.times(input.vatRate.div(100).plus(1)))
    : totalNet;

  return { totalNet, totalGross };
}

// decimal.js ROUND_HALF_UP (= 4): do najbliższej wartości, przy połowie w górę
// (od zera). Podane liczbą zamiast Prisma.Decimal.ROUND_HALF_UP, żeby nie
// zależeć od tego, czy generowany typ Prismy wystawia tę stałą statyczną.
const ROUND_HALF_UP = 4;

export function round2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, ROUND_HALF_UP);
}
