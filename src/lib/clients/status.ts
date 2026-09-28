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

// Reguły (wniosek nr 12, poprawka Tomka 27.09.2026 14:20):
// 1. blokada → NIE_KONTAKTOWAC
// 2. brak zrealizowanych wynajmów i rezerwacji → POTENCJALNY
// 3. rezerwacja w przyszłości → STALY, gdy w historii ≥ 2 zrealizowane
//    wynajmy; 0–1 → NOWY („Nowy = najwyżej 1 wynajem w całej historii”,
//    druga poprawka z wniosku 12, 27.09 16:27). Doprecyzowane 27.09 wieczorem wg kontroli Tomka:
//    Pawlik, DaCorso, So Skin, Grelecka (rezerwacja + kilka wynajmów w roku)
//    = Stałe; w Nowych tylko Karpierz (sama rezerwacja) i BlooMe (1 wynajem).
// 4. bez rezerwacji — wg ostatniego zrealizowanego wynajmu:
//    > 12 mies. → BYLY; 6–12 mies. → USPIONY;
//    < 6 mies. i ≥ 2 wynajmy w 12 mies. → STALY;
//    < 6 mies. i 1 wynajem w 12 mies.: pierwszy w historii → NOWY,
//    klientka powracająca (wcześniejsze wynajmy) → USPIONY.
// `realizedRentalDates` = daty rozpoczęcia wynajmów spełniających
// isRealizedRental — filtrowanie robi wywołujący.
export function computeClientStatus(input: {
  statusOverride: "NIE_KONTAKTOWAC" | null;
  realizedRentalDates: Date[];
  today: Date;
  hasFutureReservation?: boolean;
}): ClientStatus {
  if (input.statusOverride === "NIE_KONTAKTOWAC") return "NIE_KONTAKTOWAC";
  const ages = input.realizedRentalDates.map((d) => daysAgo(d, input.today));
  if (ages.length === 0) return input.hasFutureReservation ? "NOWY" : "POTENCJALNY";
  const inLastYear = ages.filter((a) => a <= 365).length;
  if (input.hasFutureReservation) return ages.length >= 2 ? "STALY" : "NOWY";
  const lastAge = Math.min(...ages);
  if (lastAge > 365) return "BYLY";
  if (lastAge > 180) return "USPIONY";
  if (inLastYear >= 2) return "STALY";
  return ages.length === 1 ? "NOWY" : "USPIONY";
}
