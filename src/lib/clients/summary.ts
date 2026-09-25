// Podsumowanie klienta z historii jego wynajmów — jedna czysta funkcja dla
// listy i karty klienta, żeby liczby nigdy się nie rozjeżdżały. Bez
// zależności (vitest bez aliasu "@/").
import { computeClientStatus, daysAgo, isRealizedRental, type ClientStatus } from "./status";
import type { DeviceInterestKey } from "./labels";

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

export type ClientSummary = {
  status: ClientStatus;
  rentals12m: number;
  rentalsTotal: number;
  lastRentalAt: Date | null;
  // „Klient od” — najwcześniejszy odbyty wynajem lub szkolenie (także z historii).
  firstSeenAt: Date | null;
  revenueNet: number;
  avgRentalNet: number | null;
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
  today: Date;
}): ClientSummary {
  const realized = input.rentals.filter(isRealizedRental).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
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

  const past = input.rentals.filter((r) => !r.deletedInGoogle && r.startsAt <= input.today);
  const firstSeenAt = past.length ? new Date(Math.min(...past.map((r) => r.startsAt.getTime()))) : null;

  return {
    status,
    rentals12m: realized.filter((r) => daysAgo(r.startsAt, input.today) <= 365).length,
    rentalsTotal: realized.length,
    lastRentalAt: realized[0]?.startsAt ?? null,
    firstSeenAt,
    revenueNet,
    avgRentalNet: finished.length ? Math.round((revenueNet / finished.length) * 100) / 100 : null,
    favoriteDevice: rentedDevices[0] ?? null,
    rentedDevices,
  };
}
