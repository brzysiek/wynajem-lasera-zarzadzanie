// Podsumowanie klienta z historii jego wynajmów — jedna czysta funkcja dla
// listy i karty klienta, żeby liczby nigdy się nie rozjeżdżały. Bez
// zależności (vitest bez aliasu "@/").
import { computeClientStatus, daysAgo, isRealizedRental, type ClientStatus } from "./status";
import type { DeviceInterestKey } from "./labels";
import { invoiceOnlyRentalDates } from "../history/invoices";

export type ClientRentalFact = {
  startsAt: Date;
  endsAt: Date;
  eventType: "WYNAJEM" | "SZKOLENIE";
  deletedInGoogle: boolean;
  confirmedAt: Date | null;
  totalNet: number | null; // null = wynajem bez rozliczenia (RentalFinance)
  interest: DeviceInterestKey | null; // kategoria wynajętego urządzenia
  historical?: boolean; // z historii kalendarzy (bez kwot) — status.ts
};

// Faktura z Fakturowni przypisana do klienta (AUTO/CONFIRMED, prompt 3B).
export type ClientInvoiceFact = {
  sellDate: Date;
  totalNet: number;
  hasRental: boolean; // wystawiona z panelu dla wynajmu — ten wynajem już jest w rentals
  interest: DeviceInterestKey | null;
};

export type ClientSummary = {
  status: ClientStatus;
  rentals12m: number;
  rentalsTotal: number;
  lastRentalAt: Date | null;
  // „Klient od” — najwcześniejszy odbyty wynajem lub szkolenie (także z historii).
  firstSeenAt: Date | null;
  revenueNet: number;
  avgRentalNet: number | null;
  // Suma netto przypisanych faktur (także sprzed panelu) — osobno od
  // revenueNet, które zostaje zgodne z modułem Przychody.
  invoicedNet: number;
  invoicesCount: number;
  favoriteDevice: DeviceInterestKey | null;
  rentedDevices: DeviceInterestKey[]; // od najczęściej wynajmowanego
};

// Liczby wynajmów, ostatni wynajem i ulubione urządzenie — z wynajmów
// ZREALIZOWANYCH (ta sama definicja co status, status.ts). Przychód — z
// wynajmów i szkoleń już zakończonych, nieusuniętych, suma totalNet: ta sama
// kwota co w module Przychody (src/lib/revenue/load.ts liczy wyłącznie
// totalNet; transport rozliczany osobno nie wchodzi tam do przychodu, więc
// i tu nie wchodzi). Przyszłe rezerwacje nie są jeszcze przychodem.
export function summarizeClient(input: {
  statusOverride: "NIE_KONTAKTOWAC" | null;
  rentals: ClientRentalFact[];
  invoices?: ClientInvoiceFact[];
  today: Date;
}): ClientSummary {
  const invoices = input.invoices ?? [];
  const realizedRentals = input.rentals.filter(isRealizedRental);
  // Faktura bez wynajmu w pobliżu (±7 dni) = wynajem, którego nie ma w
  // kalendarzu (prompt 3, sekcja 5 pkt 3). Urządzenie — z pozycji faktury.
  const invoiceRentals: ClientRentalFact[] = invoiceOnlyRentalDates(invoices, realizedRentals).map((date) => ({
    startsAt: date,
    endsAt: date,
    eventType: "WYNAJEM",
    deletedInGoogle: false,
    confirmedAt: null,
    totalNet: null,
    interest: invoices.find((i) => i.sellDate.getTime() === date.getTime())?.interest ?? null,
    historical: true,
  }));
  const realized = [...realizedRentals, ...invoiceRentals].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const status = computeClientStatus({
    statusOverride: input.statusOverride,
    realizedRentalDates: realized.map((r) => r.startsAt),
    today: input.today,
  });

  const finished = input.rentals.filter((r) => !r.deletedInGoogle && r.endsAt <= input.today && r.totalNet != null);
  const revenueNet = Math.round(finished.reduce((s, r) => s + (r.totalNet ?? 0), 0) * 100) / 100;

  const counts = new Map<DeviceInterestKey, number>();
  for (const r of realized) if (r.interest) counts.set(r.interest, (counts.get(r.interest) ?? 0) + 1);
  const rentedDevices = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const pastTimes = [
    ...input.rentals.filter((r) => !r.deletedInGoogle && r.startsAt <= input.today).map((r) => r.startsAt.getTime()),
    ...invoices.map((i) => i.sellDate.getTime()),
  ];
  const firstSeenAt = pastTimes.length ? new Date(Math.min(...pastTimes)) : null;
  const invoicedNet = Math.round(invoices.reduce((s, i) => s + i.totalNet, 0) * 100) / 100;

  return {
    status,
    rentals12m: realized.filter((r) => daysAgo(r.startsAt, input.today) <= 365).length,
    rentalsTotal: realized.length,
    lastRentalAt: realized[0]?.startsAt ?? null,
    firstSeenAt,
    revenueNet,
    avgRentalNet: finished.length ? Math.round((revenueNet / finished.length) * 100) / 100 : null,
    invoicedNet,
    invoicesCount: invoices.length,
    favoriteDevice: rentedDevices[0] ?? null,
    rentedDevices,
  };
}
