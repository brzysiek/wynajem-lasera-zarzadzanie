import { describe, expect, it } from "vitest";
import { costPerKm, costPerPulse, driverCostForRental, fuelCostForRental, legFuelCost, vehicleFuelCostPerKm } from "./calc";

describe("vehicleFuelCostPerKm", () => {
  it("spalanie/100 * cena paliwa", () => {
    // 8 L/100km * 6 zł/L = 0.48 zł/km
    expect(vehicleFuelCostPerKm(8, 6)).toBe(0.48);
  });
  it("brak spalania → null", () => {
    expect(vehicleFuelCostPerKm(null, 6)).toBeNull();
  });
  it("brak ceny paliwa → null", () => {
    expect(vehicleFuelCostPerKm(8, null)).toBeNull();
  });
});

describe("legFuelCost", () => {
  it("mnoży km * stawkę * 2 (tam i z powrotem)", () => {
    expect(legFuelCost(20, 1.2)).toBe(48);
  });
  it("brak dystansu → null, nie 0", () => {
    expect(legFuelCost(null, 1.2)).toBeNull();
  });
  it("brak stawki pojazdu → null", () => {
    expect(legFuelCost(20, null)).toBeNull();
  });
});

describe("fuelCostForRental", () => {
  it("sumuje etap dostawy i odbioru (ten sam pojazd → 2x legFuelCost)", () => {
    // 20km * 1.2 * 2 (dostawa) + 20km * 1.2 * 2 (odbiór) = 48 + 48 = 96
    expect(fuelCostForRental(20, 1.2, 1.2)).toBe(96);
  });
  it("różne pojazdy na dostawę i odbiór → każdy etap swoją stawką, nic nie dzielone", () => {
    // dostawa: 20*1.2*2=48, odbiór: 20*2*2=80
    expect(fuelCostForRental(20, 1.2, 2)).toBe(128);
  });
  it("brak dystansu → null (oba etapy bez danych)", () => {
    expect(fuelCostForRental(null, 1.2, 1.2)).toBeNull();
  });
  it("brak stawki obu pojazdów → null", () => {
    expect(fuelCostForRental(20, null, null)).toBeNull();
  });
  it("brak stawki tylko jednego etapu → liczy drugi, nie zeruje całości", () => {
    expect(fuelCostForRental(20, 1.2, null)).toBe(48);
  });
});

describe("driverCostForRental", () => {
  it("liczy z sumy dostawa+odbiór w godzinach razy stawka", () => {
    // 45 + 30 = 75 min = 1.25h * 40 zł/h = 50 zł
    expect(driverCostForRental(45, 30, 40)).toBe(50);
  });
  it("brak stawki → null", () => {
    expect(driverCostForRental(45, 30, null)).toBeNull();
  });
  it("zero minut łącznie → null (nie 0 zł)", () => {
    expect(driverCostForRental(null, null, 40)).toBeNull();
    expect(driverCostForRental(0, 0, 40)).toBeNull();
  });
  it("tylko jeden z dwóch czasów wypełniony liczy się normalnie", () => {
    expect(driverCostForRental(60, null, 30)).toBe(30);
  });
});

describe("costPerPulse", () => {
  it("dzieli sumę wymiany lampy przez impulsy", () => {
    expect(costPerPulse(2400, 3200)).toBe(0.75);
  });
  it("zero impulsów w okresie → null, nie dzielenie przez zero", () => {
    expect(costPerPulse(2400, 0)).toBeNull();
  });
});

describe("costPerKm", () => {
  it("(paliwo + inne) / km", () => {
    expect(costPerKm(980, 930, 1000)).toBe(1.91);
  });
  it("zero km w okresie → null", () => {
    expect(costPerKm(100, 50, 0)).toBeNull();
  });
});
