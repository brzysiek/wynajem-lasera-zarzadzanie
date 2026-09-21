import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildInvoicePositions } from "./positions";

const D = (v: number | string) => new Prisma.Decimal(v);

const BASE = {
  eventType: "WYNAJEM" as const,
  deviceName: "LightSheer DESIRE",
  startsAt: new Date("2026-03-15T00:00:00.000Z"),
  endsAt: new Date("2026-03-15T00:00:00.000Z"),
  finance: {
    baseRentalPriceNet: D(1500),
    pulseSurchargeNet: null as Prisma.Decimal | null,
    pulseCounterStart: null as number | null,
    pulseCounterEnd: null as number | null,
    capUsedHS: null as boolean | null,
    capCountHS: 1,
    capFeeNet: null as Prisma.Decimal | null,
    membraneUsed: null as boolean | null,
    membraneCount: 1,
    membraneFeeNet: null as Prisma.Decimal | null,
    transportPriceNet: null as Prisma.Decimal | null,
    transportPaidSeparately: false,
    vatApplicable: false,
    vatRate: D(23),
  },
};

describe("buildInvoicePositions", () => {
  it("wynajem 1-dniowy, bez dopłat: jedna pozycja z datą dzienną", () => {
    const positions = buildInvoicePositions(BASE);
    expect(positions).toHaveLength(1);
    expect(positions[0].name).toBe("Wynajem urządzenia LightSheer DESIRE w dniu 15.03.2026");
    expect(positions[0].totalPriceGross.toNumber()).toBe(1500);
    expect(positions[0].taxLabel).toBe("zw");
  });

  it("wynajem wielodniowy: 'w dniach od–do'", () => {
    const positions = buildInvoicePositions({ ...BASE, endsAt: new Date("2026-03-17T00:00:00.000Z") });
    expect(positions[0].name).toBe("Wynajem urządzenia LightSheer DESIRE w dniach 15.03.2026–17.03.2026");
  });

  it("szkolenie: inny prefiks etykiety", () => {
    const positions = buildInvoicePositions({ ...BASE, eventType: "SZKOLENIE" });
    expect(positions[0].name).toBe("Szkolenie – LightSheer DESIRE, w dniu 15.03.2026");
  });

  it("transport doliczony jako osobna pozycja, gdy nie jest płatny osobno", () => {
    const positions = buildInvoicePositions({
      ...BASE,
      finance: { ...BASE.finance, transportPriceNet: D(150) },
    });
    expect(positions).toHaveLength(2);
    expect(positions[1]).toMatchObject({ name: "Transport" });
    expect(positions[1].totalPriceGross.toNumber()).toBe(150);
  });

  it("transport pominięty, gdy płatny osobno (inna ścieżka rozliczenia)", () => {
    const positions = buildInvoicePositions({
      ...BASE,
      finance: { ...BASE.finance, transportPriceNet: D(150), transportPaidSeparately: true },
    });
    expect(positions).toHaveLength(1);
  });

  it("nakładka HS x2: jedna pozycja z przemnożoną kwotą", () => {
    const positions = buildInvoicePositions({
      ...BASE,
      finance: { ...BASE.finance, capUsedHS: true, capCountHS: 2, capFeeNet: D(70) },
    });
    expect(positions).toHaveLength(2);
    expect(positions[1].name).toBe("Nakładki HS (2 × 70 zł)");
    expect(positions[1].totalPriceGross.toNumber()).toBe(140);
  });

  it("membrana pojedyncza: etykieta bez mnożnika", () => {
    const positions = buildInvoicePositions({
      ...BASE,
      finance: { ...BASE.finance, membraneUsed: true, membraneCount: 1, membraneFeeNet: D(70) },
    });
    expect(positions[1].name).toBe("Membrana");
  });

  it("dopłata za impulsy Alma z liczbą impulsów w etykiecie", () => {
    const positions = buildInvoicePositions({
      ...BASE,
      finance: {
        ...BASE.finance,
        pulseSurchargeNet: D(200),
        pulseCounterStart: 100,
        pulseCounterEnd: 350,
      },
    });
    expect(positions[1].name).toBe("Dopłata za impulsy (250 szt.)");
    expect(positions[1].totalPriceGross.toNumber()).toBe(200);
  });

  it("VAT doliczony do gross, gdy vatApplicable", () => {
    const positions = buildInvoicePositions({
      ...BASE,
      finance: { ...BASE.finance, vatApplicable: true, vatRate: D(23) },
    });
    expect(positions[0].totalPriceGross.toNumber()).toBe(1845);
    expect(positions[0].taxLabel).toBe("23");
  });

  it("zerowe/ujemne kwoty dopłat nie tworzą pustych pozycji", () => {
    const positions = buildInvoicePositions({
      ...BASE,
      finance: { ...BASE.finance, capUsedHS: true, capFeeNet: D(0) },
    });
    expect(positions).toHaveLength(1);
  });
});
