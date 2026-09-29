import { describe, expect, it } from "vitest";
import { CONFIRMATION_TRACKED_SINCE, arrivalDates, arrivalRhythmLabel, computeClientStatus, daysAgo, isRealizedRental } from "./status";

const today = new Date(2026, 9, 1, 12, 0); // 1.10.2026, 12:00
const ago = (n: number) => new Date(2026, 9, 1 - n, 10, 0);

function status(dates: Date[], statusOverride: "NIE_KONTAKTOWAC" | null = null, reservations: Date[] = []) {
  return computeClientStatus({ statusOverride, realizedRentalDates: dates, today, reservationDates: reservations });
}
const soon = new Date(2026, 9, 7); // rezerwacja 07.10

describe("computeClientStatus (wniosek 20, decyzja 29.09)", () => {
  it("blokada wygrywa ze wszystkim", () => {
    expect(status([ago(1), ago(30)], "NIE_KONTAKTOWAC")).toBe("NIE_KONTAKTOWAC");
    expect(status([ago(400)], "NIE_KONTAKTOWAC", [soon])).toBe("NIE_KONTAKTOWAC");
  });

  it("bez przyjazdów i rezerwacji → POTENCJALNY", () => {
    expect(status([])).toBe("POTENCJALNY");
  });

  it("same rezerwacje (także seria) → NOWY; ≥ 1 zrealizowany + rezerwacja → STALY", () => {
    expect(status([], null, [soon])).toBe("NOWY"); // Cybul — sama rezerwacja 01.10
    expect(status([], null, [soon, new Date(2026, 10, 20)])).toBe("NOWY");
    expect(status([ago(200)], null, [soon])).toBe("STALY");
    expect(status([ago(800)], null, [soon])).toBe("STALY"); // była klientka z historią wraca od razu do Stałych
    expect(status([ago(590), ago(700)], null, [soon])).toBe("STALY"); // Bigos — przyjazdy 2023–2025 + rezerwacja 07.10
  });

  it("rezerwacja w ciągu 3 dni od zrealizowanego to ten sam przyjazd", () => {
    expect(status([ago(1)], null, [new Date(2026, 9, 2)])).toBe("NOWY");
  });

  it("liczymy przyjazdy, nie urządzenia: kilka wynajmów w ciągu 3 dni = 1 przyjazd", () => {
    expect(status([ago(10), ago(10), ago(12)])).toBe("NOWY"); // Cooltech + LightSheer tego samego dnia
    expect(status([ago(10), ago(20)])).toBe("STALY");
  });

  it("bez rezerwacji: > 12 mies. → BYLY, 6–12 mies. → USPIONY", () => {
    expect(status([ago(366), ago(500)])).toBe("BYLY");
    expect(status([ago(181)])).toBe("USPIONY");
    expect(status([ago(200), ago(300)])).toBe("USPIONY");
    expect(status([ago(365)])).toBe("USPIONY");
  });

  it("bez rezerwacji, ostatni ≤ 6 mies.: ≥ 2 przyjazdy w historii → STALY, 1 → NOWY", () => {
    expect(status([ago(10), ago(200)])).toBe("STALY");
    expect(status([ago(170), ago(400), ago(500)])).toBe("STALY"); // Esensi — wieloletnia, ostatni 13.04
    expect(status([ago(10)])).toBe("NOWY");
    expect(status([ago(180)])).toBe("NOWY");
  });
});

describe("arrivalDates / arrivalRhythmLabel", () => {
  it("grupuje wynajmy w ciągu 3 dni od poprzedniego", () => {
    expect(arrivalDates([ago(10), ago(12), ago(9), ago(40)]).length).toBe(2);
  });

  it("rytm: co ~N tyg. / co ~N mies., okazjonalnie (< 2 w roku), brak przy 1 przyjeździe", () => {
    expect(arrivalRhythmLabel([ago(10), ago(45), ago(80)])).toBe("co ~5 tyg.");
    expect(arrivalRhythmLabel([ago(10), ago(100), ago(190)])).toBe("co ~3 mies.");
    expect(arrivalRhythmLabel([ago(10), ago(300), ago(600)])).toBe("okazjonalnie");
    expect(arrivalRhythmLabel([ago(10), ago(11)])).toBeNull();
  });
});

describe("daysAgo", () => {
  it("liczy dni kalendarzowe, nie 24-godzinne odcinki", () => {
    expect(daysAgo(new Date(2026, 8, 30, 23, 59), today)).toBe(1);
  });

  it("przyszła data = 0", () => {
    expect(daysAgo(new Date(2026, 9, 5), today)).toBe(0);
  });
});

describe("isRealizedRental", () => {
  const base = { eventType: "WYNAJEM" as const, deletedInGoogle: false, confirmedAt: null };

  it("potwierdzony wynajem po 22.09 → zrealizowany", () => {
    expect(isRealizedRental({ ...base, endsAt: new Date(2026, 8, 28), confirmedAt: new Date(2026, 8, 28) })).toBe(true);
  });

  it("niepotwierdzony wynajem po 22.09 → nie", () => {
    expect(isRealizedRental({ ...base, endsAt: new Date(2026, 8, 28) })).toBe(false);
  });

  it("wynajem zakończony przed 22.09 bez potwierdzenia → zrealizowany", () => {
    expect(isRealizedRental({ ...base, endsAt: new Date(2026, 7, 15) })).toBe(true);
  });

  it("wynajem z 21.09 (endsAt = północ 22.09) jeszcze się łapie", () => {
    expect(isRealizedRental({ ...base, endsAt: CONFIRMATION_TRACKED_SINCE })).toBe(true);
  });

  it("usunięty w Google → nie", () => {
    expect(isRealizedRental({ ...base, deletedInGoogle: true, endsAt: new Date(2026, 7, 15) })).toBe(false);
  });

  it("szkolenie → nie liczy się do statusu", () => {
    expect(isRealizedRental({ ...base, eventType: "SZKOLENIE", endsAt: new Date(2026, 7, 15) })).toBe(false);
  });
});
