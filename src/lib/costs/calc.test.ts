import { describe, expect, it } from "vitest";
import { costPerKm, costPerPulse, driverCostForRental, fuelCostForRental } from "./calc";

describe("fuelCostForRental", () => {
  it("mnoży km * stawkę", () => {
    expect(fuelCostForRental(20, 1.2)).toBe(24);
  });
  it("brak dystansu → null, nie 0", () => {
    expect(fuelCostForRental(null, 1.2)).toBeNull();
  });
  it("brak stawki pojazdu (brak vehicleId/fuelCostPerKm) → null", () => {
    expect(fuelCostForRental(20, null)).toBeNull();
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
