// Faktury z Fakturowni w historii klienta (prompt 3B) — czyste funkcje bez
// zależności (vitest bez aliasu "@/").
import type { DeviceInterestKey } from "../clients/labels";

// Urządzenie z nazw pozycji faktury („Wynajem lasera LightSheer Desire…”).
const INTEREST_PATTERNS: [RegExp, DeviceInterestKey][] = [
  [/et\s?-?400/, "LIGHTSHEER_ET400"],
  [/lightsheer|light sheer|desire|quattro/, "LIGHTSHEER"],
  [/alma|harmony|ipixel|dye[\s-]?vl/, "ALMA_HARMONY"],
  [/cooltech|kriolipoliz/, "COOLTECH"],
  [/resur\s?fx|resurfx/, "RESURFX"],
  [/observ/, "OBSERV"],
  [/szkolen/, "SZKOLENIE"],
];

export function interestsFromText(text: string | null | undefined): DeviceInterestKey[] {
  if (!text) return [];
  const t = text.toLowerCase();
  return INTEREST_PATTERNS.filter(([re]) => re.test(t)).map(([, k]) => k);
}

const DAY_MS = 86_400_000;

// Faktura jako dowód wynajmu, którego nie ma w kalendarzu (prompt 3, sekcja
// 5 pkt 3): dopasowana, niepowiązana z wynajmem z panelu i nie leży w ±7
// dniach od żadnego znanego wynajmu tego klienta. Kilka faktur w odstępie
// ≤ 7 dni (np. zaliczka + reszta) to jeden wynajem.
export function invoiceOnlyRentalDates(
  invoices: { sellDate: Date; hasRental: boolean }[],
  rentals: { startsAt: Date; endsAt: Date }[],
  windowDays = 7,
): Date[] {
  const w = windowDays * DAY_MS;
  const near = (d: Date) => rentals.some((r) => d.getTime() >= r.startsAt.getTime() - w && d.getTime() <= r.endsAt.getTime() + w);
  const kept: Date[] = [];
  for (const inv of [...invoices].sort((a, b) => a.sellDate.getTime() - b.sellDate.getTime())) {
    if (inv.hasRental || near(inv.sellDate)) continue;
    const last = kept.at(-1);
    if (last && inv.sellDate.getTime() - last.getTime() <= w) continue;
    kept.push(inv.sellDate);
  }
  return kept;
}
