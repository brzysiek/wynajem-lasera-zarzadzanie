// Status klienta — LICZONY z historii wynajmów przy odczycie, nigdzie nie
// zapisywany (jedyny wyjątek: ręczna blokada NIE_KONTAKTOWAC na kliencie).
// Czyste funkcje bez zależności (vitest bez aliasu "@/"). Daty po lokalnych
// składowych — serwer działa w Europe/Warsaw, jak reszta aplikacji
// (src/lib/pricing/duration.ts, src/lib/revenue/period.ts).

export type ClientStatus = "POTENCJALNY" | "NOWY" | "STALY" | "USPIONY" | "BYLY" | "NIE_KONTAKTOWAC";

// Potwierdzenie odbioru przez kierowcę (RentalFinance.confirmedAt) istnieje
// dopiero od 22.09.2026. Wynajmy zakończone przed tym dniem nie mają i nie
// będą miały potwierdzenia, więc — decyzja użytkownika — liczą się jako
// zrealizowane, jeśli nie zostały usunięte w Google. Bez tego prawie każdy
// klient wyszedłby jako "Potencjalny". ŚWIADOMIE inna reguła niż podział
// rzeczywiste/preliminowane w przychodach (src/lib/revenue/aggregate.ts),
// który zostaje bez zmian.
// endsAt wynajmu całodniowego to północ następnego dnia, stąd `<=`: wynajem
// z 21.09 (endsAt = 22.09 00:00) jeszcze się łapie.
export const CONFIRMATION_TRACKED_SINCE = new Date(2026, 8, 22);

export function isRealizedRental(rental: {
  eventType: "WYNAJEM" | "SZKOLENIE";
  deletedInGoogle: boolean;
  endsAt: Date;
  confirmedAt: Date | null;
  // Wydarzenie z historii kalendarzy (rental_history, prompt 3A) przypisane
  // automatycznie albo potwierdzone przez biuro — z definicji odbyte.
  historical?: boolean;
}): boolean {
  // Szkolenia nie liczą się do statusu klienta (spec, sekcja 2).
  if (rental.eventType !== "WYNAJEM") return false;
  if (rental.deletedInGoogle) return false;
  if (rental.historical) return true;
  if (rental.confirmedAt) return true;
  return rental.endsAt <= CONFIRMATION_TRACKED_SINCE;
}

function dayIndex(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
}

// Ile dni kalendarzowych temu (0 = dziś). Przyszłe daty liczą się jako 0.
export function daysAgo(date: Date, today: Date): number {
  return Math.max(0, dayIndex(today) - dayIndex(date));
}

// Reguły w tej kolejności (spec, sekcja 2):
// 1. blokada → NIE_KONTAKTOWAC
// 2. brak zrealizowanych wynajmów → POTENCJALNY
// 3. ostatni wynajem > 365 dni temu → BYLY
// 4. ostatni wynajem 181–365 dni temu → USPIONY
// 5. ≥ 2 wynajmy w ostatnich 365 dniach → STALY
// 6. w przeciwnym razie → NOWY
// `realizedRentalDates` = daty rozpoczęcia wynajmów spełniających
// isRealizedRental — filtrowanie robi wywołujący.
export function computeClientStatus(input: {
  statusOverride: "NIE_KONTAKTOWAC" | null;
  realizedRentalDates: Date[];
  today: Date;
}): ClientStatus {
  if (input.statusOverride === "NIE_KONTAKTOWAC") return "NIE_KONTAKTOWAC";
  if (input.realizedRentalDates.length === 0) return "POTENCJALNY";

  const ages = input.realizedRentalDates.map((d) => daysAgo(d, input.today));
  const lastAge = Math.min(...ages);
  if (lastAge > 365) return "BYLY";
  if (lastAge > 180) return "USPIONY";
  const inLastYear = ages.filter((a) => a <= 365).length;
  return inLastYear >= 2 ? "STALY" : "NOWY";
}
