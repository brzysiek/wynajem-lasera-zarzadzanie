import { describe, expect, it } from "vitest";
import { CONFIRMATION_TRACKED_SINCE, computeClientStatus, daysAgo, isRealizedRental } from "./status";

const today = new Date(2026, 9, 1, 12, 0); // 1.10.2026, 12:00
const ago = (n: number) => new Date(2026, 9, 1 - n, 10, 0);

function status(dates: Date[], statusOverride: "NIE_KONTAKTOWAC" | null = null) {
  return computeClientStatus({ statusOverride, realizedRentalDates: dates, today });
}

describe("computeClientStatus", () => {
  it("blokada wygrywa ze wszystkim", () => {
    expect(status([ago(1), ago(30)], "NIE_KONTAKTOWAC")).toBe("NIE_KONTAKTOWAC");
  });

  it("bez zrealizowanych wynajmów → POTENCJALNY", () => {
    expect(status([])).toBe("POTENCJALNY");
  });

  it("jeden świeży wynajem → NOWY", () => {
    expect(status([ago(10)])).toBe("NOWY");
  });

  it("dwa wynajmy w ostatnim roku → STALY", () => {
    expect(status([ago(10), ago(200)])).toBe("STALY");
  });

  it("drugi wynajem dokładnie 365 dni temu wciąż się liczy → STALY", () => {
    expect(status([ago(10), ago(365)])).toBe("STALY");
  });

  it("drugi wynajem 366 dni temu już nie → NOWY", () => {
    expect(status([ago(10), ago(366)])).toBe("NOWY");
  });

  it("ostatni wynajem 180 dni temu → jeszcze nie uśpiony", () => {
    expect(status([ago(180)])).toBe("NOWY");
  });

  it("ostatni wynajem 181 dni temu → USPIONY", () => {
    expect(status([ago(181)])).toBe("USPIONY");
  });

  it("ostatni wynajem 365 dni temu → USPIONY", () => {
    expect(status([ago(365)])).toBe("USPIONY");
  });

  it("ostatni wynajem 366 dni temu → BYLY", () => {
    expect(status([ago(366), ago(500)])).toBe("BYLY");
  });

  it("uśpiony mimo kilku wynajmów w roku, jeśli ostatni > 180 dni", () => {
    expect(status([ago(200), ago(300)])).toBe("USPIONY");
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
