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

// Przyjazdy (wniosek 20, decyzja Tomka 29.09.2026): liczymy przyjazdy, nie
// urządzenia — kilka wynajmów tego samego dnia albo w ciągu 3 dni od
// poprzedniego to jeden przyjazd. Zwraca datę pierwszego dnia każdego
// przyjazdu, od najstarszego.
export const ARRIVAL_GAP_DAYS = 3;

export function arrivalDates(dates: Date[]): Date[] {
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const out: Date[] = [];
  let last: Date | null = null;
  for (const d of sorted) {
    if (!last || dayIndex(d) - dayIndex(last) > ARRIVAL_GAP_DAYS) out.push(d);
    last = d;
  }
  return out;
}

// Reguły (wniosek 20, decyzja Tomka 29.09.2026 — zastępuje regułę 12 mies.
// z wniosku 12). Status = relacja; „aktywna” = rezerwacja albo ostatni
// przyjazd ≤ 6 mies. temu:
// 1. blokada → NIE_KONTAKTOWAC
// 2. brak przyjazdów i rezerwacji → POTENCJALNY
// 3. same rezerwacje, bez zrealizowanego przyjazdu → NOWY (seria rezerwacji
//    nowej klientki też)
// 4. ≥ 1 zrealizowany + rezerwacja → STALY (także była klientka z historią,
//    która zarezerwowała — od razu Stała, nie Nowa)
// 5. bez rezerwacji, wg ostatniego przyjazdu: > 12 mies. → BYLY;
//    6–12 mies. → USPIONY; ≤ 6 mies.: ≥ 2 przyjazdy → STALY, 1 → NOWY.
// Rezerwacja liczy się od wpisania do kalendarza (wynajem, nie szkolenie,
// nieusunięty, w przyszłości) — anulowanie w Google ją zdejmuje.
// `realizedRentalDates` = daty rozpoczęcia wynajmów spełniających
// isRealizedRental (filtrowanie robi wywołujący); `reservationDates` —
// przyszłe rezerwacje (rezerwacja w ciągu 3 dni od zrealizowanego przyjazdu
// to ten sam przyjazd, nie nowy).
export function computeClientStatus(input: {
  statusOverride: "NIE_KONTAKTOWAC" | null;
  realizedRentalDates: Date[];
  today: Date;
  reservationDates?: Date[];
  hasFutureReservation?: boolean;
}): ClientStatus {
  if (input.statusOverride === "NIE_KONTAKTOWAC") return "NIE_KONTAKTOWAC";
  const realized = arrivalDates(input.realizedRentalDates);
  const lastRealized = realized[realized.length - 1] ?? null;
  const reservations = (input.reservationDates ?? []).filter((d) => !lastRealized || dayIndex(d) - dayIndex(lastRealized) > ARRIVAL_GAP_DAYS);
  const hasReservation = reservations.length > 0 || (input.hasFutureReservation === true && !input.reservationDates);
  if (!lastRealized) return hasReservation ? "NOWY" : "POTENCJALNY";
  if (hasReservation) return "STALY";
  const lastAge = daysAgo(lastRealized, input.today);
  if (lastAge > 365) return "BYLY";
  if (lastAge > 180) return "USPIONY";
  return realized.length >= 2 ? "STALY" : "NOWY";
}

// Rytm obok statusu (wniosek 20, pkt 4): „co ok. N mies.” z mediany odstępów
// między przyjazdami albo „okazjonalnie”, gdy wychodzi mniej niż 2 przyjazdy
// w roku. Przy jednym przyjeździe — brak rytmu.
export function arrivalRhythmLabel(realizedRentalDates: Date[]): string | null {
  const a = arrivalDates(realizedRentalDates);
  if (a.length < 2) return null;
  const gaps = a.slice(1).map((d, i) => dayIndex(d) - dayIndex(a[i])).sort((x, y) => x - y);
  const mid = gaps.length / 2;
  const median = gaps.length % 2 ? gaps[Math.floor(mid)] : (gaps[mid - 1] + gaps[mid]) / 2;
  if (median > 365 / 2) return "okazjonalnie";
  return `co ok. ${Math.max(1, Math.round(median / 30.44))} mies.`;
}
