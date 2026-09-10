import { describe, expect, it } from "vitest";
import {
  bestWorstClientAvg,
  bestWorstUtilization,
  computeClientBreakdown,
  computeDeviceBreakdown,
  computeDurationHistogram,
  computeKpis,
  computePaymentSplit,
  NO_CLIENT_ID,
  pendingPriceCount,
  REST_CLIENTS_ID,
  trendPct,
  type RevenueRow,
} from "./aggregate";

function row(over: Partial<RevenueRow>): RevenueRow {
  return {
    id: Math.random().toString(36),
    eventType: "WYNAJEM",
    deviceId: "dev-a",
    deviceName: "Device A",
    startsAt: "2026-09-10T12:00:00.000Z",
    startDate: "2026-09-10",
    endDate: "2026-09-10",
    durationDays: 1,
    totalNet: 1000,
    paymentMethod: "TRANSFER",
    pulsePending: false,
    hubspotContactId: "c1",
    contactLabel: "Klient 1",
    ...over,
  };
}

describe("computeKpis", () => {
  it("suma netto, liczby, średnia, unikalni klienci (null nie liczy się jako klient)", () => {
    const rows = [
      row({ totalNet: 1000, hubspotContactId: "c1" }),
      row({ totalNet: 2000, hubspotContactId: "c2" }),
      row({ totalNet: 600, eventType: "SZKOLENIE", hubspotContactId: null }),
    ];
    const k = computeKpis(rows);
    expect(k.revenueNet).toBe(3600);
    expect(k.rentalCount).toBe(3);
    expect(k.trainingCount).toBe(1);
    expect(k.avgValue).toBe(1200);
    expect(k.uniqueClients).toBe(2);
  });

  it("zero wynajmów → avgValue null (bez dzielenia przez zero)", () => {
    expect(computeKpis([]).avgValue).toBeNull();
  });
});

describe("trendPct", () => {
  it("poprzedni okres = 0 → null (nie Infinity/NaN)", () => {
    expect(trendPct(5000, 0)).toBeNull();
  });
  it("wzrost i spadek, zaokrąglone do całości", () => {
    expect(trendPct(112, 100)).toBe(12);
    expect(trendPct(92, 100)).toBe(-8);
  });
});

describe("computeDeviceBreakdown", () => {
  it("grupuje po urządzeniu, „Szkolenia” zawsze na końcu, sort malejąco po przychodzie", () => {
    const rows = [
      row({ deviceId: "a", deviceName: "A", totalNet: 1000, durationDays: 2 }),
      row({ deviceId: "b", deviceName: "B", totalNet: 3000, durationDays: 1 }),
      row({ deviceId: "a", deviceName: "A", totalNet: 500, durationDays: 1 }),
      row({ eventType: "SZKOLENIE", deviceId: "x", deviceName: "X", totalNet: 9999 }),
    ];
    const out = computeDeviceBreakdown(rows, 30);
    expect(out.map((d) => d.name)).toEqual(["B", "A", "Szkolenia"]);
    expect(out[1].rentalCount).toBe(2);
    expect(out[1].avgValue).toBe(750);
    // A: 3 dni wynajęte / 30 = 10%
    expect(out[1].utilizationPct).toBe(10);
    // Szkolenia bez wykorzystania
    expect(out[2].utilizationPct).toBeNull();
  });

  it("wykorzystanie nie przekracza 100% mimo błędnych, nakładających się danych", () => {
    const rows = [
      row({ deviceId: "a", deviceName: "A", durationDays: 20 }),
      row({ deviceId: "a", deviceName: "A", durationDays: 20 }),
    ];
    expect(computeDeviceBreakdown(rows, 30)[0].utilizationPct).toBe(100);
  });
});

describe("bestWorstUtilization", () => {
  it("mniej niż 2 urządzenia z przychodem → null", () => {
    const rows = [row({ deviceId: "a", deviceName: "A" })];
    expect(bestWorstUtilization(computeDeviceBreakdown(rows, 30))).toBeNull();
  });
  it("dwa urządzenia → best = wyższe wykorzystanie, worst = niższe", () => {
    const rows = [
      row({ deviceId: "a", deviceName: "A", durationDays: 20 }),
      row({ deviceId: "b", deviceName: "B", durationDays: 3 }),
    ];
    const bw = bestWorstUtilization(computeDeviceBreakdown(rows, 30));
    expect(bw?.best.name).toBe("A");
    expect(bw?.worst.name).toBe("B");
  });
});

describe("computeDurationHistogram", () => {
  it("kategorie 1/2/3, >3 dni doliczane do „3 dni”, szkolenia pomijane", () => {
    const rows = [
      row({ durationDays: 1 }),
      row({ durationDays: 1 }),
      row({ durationDays: 2 }),
      row({ durationDays: 5 }),
      row({ durationDays: 3, eventType: "SZKOLENIE" }),
    ];
    const h = computeDurationHistogram(rows);
    expect(h.map((b) => b.count)).toEqual([2, 1, 1]);
    expect(h[0].pct).toBe(50);
  });
});

describe("computePaymentSplit", () => {
  it("dzieli sumę netto wg metody, WYNAJEM + SZKOLENIE razem", () => {
    const rows = [
      row({ paymentMethod: "CASH", totalNet: 600 }),
      row({ paymentMethod: "TRANSFER", totalNet: 400, eventType: "SZKOLENIE" }),
    ];
    const s = computePaymentSplit(rows);
    expect(s.find((x) => x.method === "CASH")).toMatchObject({ sum: 600, pct: 60 });
    expect(s.find((x) => x.method === "TRANSFER")).toMatchObject({ sum: 400, pct: 40 });
  });
});

describe("pendingPriceCount", () => {
  it("liczy wydarzenia z ceną tymczasową", () => {
    expect(pendingPriceCount([row({ pulsePending: true }), row({}), row({ pulsePending: true })])).toBe(2);
  });
});

describe("computeClientBreakdown", () => {
  it("grupuje po hubspotContactId, liczy śr. wartość i różne urządzenia, odznaka Nowy", () => {
    const rows = [
      row({ hubspotContactId: "c1", contactLabel: "Beauty Studio", totalNet: 2000, deviceId: "a" }),
      row({ hubspotContactId: "c1", contactLabel: "Beauty Studio", totalNet: 2000, deviceId: "b" }),
      row({ hubspotContactId: "c2", contactLabel: "Wellness", totalNet: 1000, deviceId: "a" }),
    ];
    const out = computeClientBreakdown(rows, new Set(["c2"]));
    const c1 = out.find((c) => c.id === "c1")!;
    expect(c1.rentalCount).toBe(2);
    expect(c1.avgValue).toBe(2000);
    expect(c1.deviceCount).toBe(2);
    expect(c1.isNew).toBe(false);
    expect(out.find((c) => c.id === "c2")!.isNew).toBe(true);
    // sort malejąco po przychodzie
    expect(out[0].id).toBe("c1");
  });

  it("wydarzenia bez kontaktu: jeden wiersz zbiorczy na koncu, deviceCount null", () => {
    const rows = [
      row({ hubspotContactId: "c1", totalNet: 1000 }),
      row({ hubspotContactId: null, totalNet: 500 }),
      row({ hubspotContactId: null, totalNet: 700 }),
    ];
    const out = computeClientBreakdown(rows, new Set());
    const none = out[out.length - 1];
    expect(none.id).toBe(NO_CLIENT_ID);
    expect(none.rentalCount).toBe(2);
    expect(none.revenueNet).toBe(1200);
    expect(none.deviceCount).toBeNull();
  });

  it("powyzej progu: top 6 + zbiorczy wiersz pozostali klienci N", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ hubspotContactId: `c${i}`, contactLabel: `K${i}`, totalNet: 1000 - i * 50 }),
    );
    const out = computeClientBreakdown(rows, new Set());
    expect(out).toHaveLength(7);
    expect(out[6].id).toBe(REST_CLIENTS_ID);
    expect(out[6].name).toBe("pozostali klienci (4)");
    expect(out[6].rentalCount).toBe(4);
    // wiersz zbiorczy niesie pojedynczych klientów do rozwinięcia w UI
    expect(out[6].hidden).toHaveLength(4);
    expect(out[6].hidden!.every((h) => h.kind === "named")).toBe(true);
  });

  it("dokładnie na progu (8) → bez zwijania", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ hubspotContactId: `c${i}`, totalNet: 100 }));
    expect(computeClientBreakdown(rows, new Set())).toHaveLength(8);
  });
});

describe("bestWorstClientAvg", () => {
  it("liczy po średniej wartości wynajmu, nie po przychodzie; pomija wiersze zbiorcze", () => {
    // c1: przychód 4000 (2 wynajmy, śr 2000). c2: przychód 2550 (1 wynajem, śr 2550).
    const rows = [
      row({ hubspotContactId: "c1", contactLabel: "Duży łączny", totalNet: 2000 }),
      row({ hubspotContactId: "c1", contactLabel: "Duży łączny", totalNet: 2000 }),
      row({ hubspotContactId: "c2", contactLabel: "Wysoka średnia", totalNet: 2550 }),
      row({ hubspotContactId: null, totalNet: 9999 }),
    ];
    const bw = bestWorstClientAvg(computeClientBreakdown(rows, new Set()))!;
    expect(bw.best.name).toBe("Wysoka średnia"); // 2550 > 2000 mimo mniejszego przychodu
    expect(bw.worst.name).toBe("Duży łączny");
  });

  it("mniej niż 2 nazwanych klientów → null", () => {
    const rows = [row({ hubspotContactId: "c1" }), row({ hubspotContactId: null })];
    expect(bestWorstClientAvg(computeClientBreakdown(rows, new Set()))).toBeNull();
  });
});
