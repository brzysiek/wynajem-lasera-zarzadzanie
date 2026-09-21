import { Prisma, type RentalEventType } from "@prisma/client";
import { round2 } from "../pricing/total";
import { rentalDurationDays } from "../pricing/duration";

export type InvoicePosition = {
  name: string;
  quantity: number;
  taxLabel: string; // np. "23", "8", "zw" — pole `tax` w POST /invoices.json
  totalPriceGross: Prisma.Decimal;
};

export type InvoicePositionsInput = {
  eventType: RentalEventType;
  deviceName: string;
  startsAt: Date;
  endsAt: Date;
  finance: {
    baseRentalPriceNet: Prisma.Decimal;
    pulseSurchargeNet: Prisma.Decimal | null;
    pulseCounterStart: number | null;
    pulseCounterEnd: number | null;
    capUsedHS: boolean | null;
    capCountHS: number;
    capFeeNet: Prisma.Decimal | null;
    membraneUsed: boolean | null;
    membraneCount: number;
    membraneFeeNet: Prisma.Decimal | null;
    transportPriceNet: Prisma.Decimal | null;
    transportPaidSeparately: boolean;
    vatApplicable: boolean;
    vatRate: Prisma.Decimal;
  };
};

function formatDate(d: Date): string {
  return d.toLocaleDateString("pl-PL");
}

// "w dniu 15.03.2026" (1 dzień) / "w dniach 15.03.2026–17.03.2026" (kilka) —
// ustalone z użytkownikiem. `rentalDurationDays` to ta sama funkcja, która
// liczy dni na potrzeby cennika (inclusive), więc rozbicie 1-dniowe vs
// wielodniowe jest spójne z resztą apki.
function rentalDateLabel(startsAt: Date, endsAt: Date): string {
  const days = rentalDurationDays(startsAt, endsAt);
  return days <= 1 ? `w dniu ${formatDate(startsAt)}` : `w dniach ${formatDate(startsAt)}–${formatDate(endsAt)}`;
}

// UWAGA: `taxLabel` = "zw" gdy vatApplicable=false — to założenie do
// potwierdzenia z użytkownikiem (może powinno być "np." albo konkretna
// stawka 0% zamiast zwolnienia — to decyzja księgowa, nie techniczna).
function toGross(net: Prisma.Decimal, vatApplicable: boolean, vatRate: Prisma.Decimal): Prisma.Decimal {
  return vatApplicable ? round2(net.times(vatRate.div(100).plus(1))) : round2(net);
}

// Pozycje faktury — jedna pozycja per składnik rozliczenia, mirror tego, co
// kierowca widzi w "Rozbiciu kwoty" (driver-finance-panel.tsx), ale liczone
// tu z Decimal zapisanych na serwerze (autorytatywne), nie z podglądu
// klienckiego. CELOWO bez rozbijania LightSheer "flex" na "podstawa" +
// "doliczenie za impulsy" — na fakturze to jedna pozycja z pełną
// baseRentalPriceNet (rozróżnienie ma sens tylko jako podgląd wewnętrzny).
export function buildInvoicePositions(input: InvoicePositionsInput): InvoicePosition[] {
  const { finance } = input;
  const isSzkolenie = input.eventType === "SZKOLENIE";
  const taxLabel = finance.vatApplicable ? finance.vatRate.toString() : "zw";
  const gross = (net: Prisma.Decimal) => toGross(net, finance.vatApplicable, finance.vatRate);

  const positions: InvoicePosition[] = [];

  const baseLabel = isSzkolenie
    ? `Szkolenie – ${input.deviceName}, ${rentalDateLabel(input.startsAt, input.endsAt)}`
    : `Wynajem urządzenia ${input.deviceName} ${rentalDateLabel(input.startsAt, input.endsAt)}`;
  positions.push({ name: baseLabel, quantity: 1, taxLabel, totalPriceGross: gross(finance.baseRentalPriceNet) });

  if (finance.pulseSurchargeNet && finance.pulseSurchargeNet.greaterThan(0)) {
    const pulsesUsed =
      finance.pulseCounterStart != null && finance.pulseCounterEnd != null
        ? finance.pulseCounterEnd - finance.pulseCounterStart
        : null;
    positions.push({
      name: `Dopłata za impulsy${pulsesUsed != null ? ` (${pulsesUsed} szt.)` : ""}`,
      quantity: 1,
      taxLabel,
      totalPriceGross: gross(finance.pulseSurchargeNet),
    });
  }

  if (!isSzkolenie && !finance.transportPaidSeparately && finance.transportPriceNet && finance.transportPriceNet.greaterThan(0)) {
    positions.push({ name: "Transport", quantity: 1, taxLabel, totalPriceGross: gross(finance.transportPriceNet) });
  }

  if (finance.capUsedHS && finance.capFeeNet && finance.capFeeNet.greaterThan(0)) {
    const count = Math.max(1, finance.capCountHS);
    positions.push({
      name: count > 1 ? `Nakładki HS (${count} × ${finance.capFeeNet.toString()} zł)` : "Nakładka HS",
      quantity: 1,
      taxLabel,
      totalPriceGross: gross(finance.capFeeNet.times(count)),
    });
  }

  if (finance.membraneUsed && finance.membraneFeeNet && finance.membraneFeeNet.greaterThan(0)) {
    const count = Math.max(1, finance.membraneCount);
    positions.push({
      name: count > 1 ? `Membrany (${count} × ${finance.membraneFeeNet.toString()} zł)` : "Membrana",
      quantity: 1,
      taxLabel,
      totalPriceGross: gross(finance.membraneFeeNet.times(count)),
    });
  }

  return positions;
}
