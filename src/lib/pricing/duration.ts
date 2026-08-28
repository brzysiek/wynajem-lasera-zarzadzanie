// Liczba dni wynajmu, liczona INCLUSIVE: wynajem 28–30 sierpnia to 3 dni
// (nie 2), a "1 tydzień" Observ to durationDays = 7. Odpowiada temu, jak
// kalendarz rysuje pasek wynajmu (rentalTouchesDay w calendar-view.tsx:
// endsAt to północ ostatniego dnia, wciąż "dotykana").
//
// Dni liczymy po lokalnych składowych daty (serwer działa w Europe/Warsaw),
// ale przez indeks dnia z Date.UTC — odporne na DST, bez błędu ±1 na
// przejściach czasu.
function dayIndex(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

export function rentalDurationDays(startsAt: Date, endsAt: Date): number {
  const days = dayIndex(endsAt) - dayIndex(startsAt) + 1;
  return days < 1 ? 1 : days;
}
