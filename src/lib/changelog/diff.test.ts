import { describe, expect, it } from "vitest";
import { changedFields, fromLogValue, toLogValue } from "./diff";

const dec = (v: string) => ({ toFixed: () => v, toString: () => v });

describe("changedFields", () => {
  it("tylko pola, które się zmieniają", () => {
    expect(changedFields({ city: "Krakow", nip: "123" }, { city: "Kraków", nip: "123" })).toEqual([
      { field: "city", before: '"Krakow"', after: '"Kraków"' },
    ]);
  });
  it("pusty tekst i null to to samo", () => {
    expect(changedFields({ street: null }, { street: "" })).toEqual([]);
    expect(changedFields({ street: "Długa 1" }, { street: null })).toEqual([{ field: "street", before: '"Długa 1"', after: "null" }]);
  });
  it("kwoty: 150 = 150.00", () => {
    expect(changedFields({ transportPriceNet: dec("150") }, { transportPriceNet: "150.00" })).toEqual([]);
    expect(changedFields({ transportPriceNet: dec("150") }, { transportPriceNet: "180" })).toHaveLength(1);
  });
  it("tablice i daty", () => {
    expect(changedFields({ deviceInterests: ["COOLTECH"] }, { deviceInterests: ["COOLTECH"] })).toEqual([]);
    expect(changedFields({ deviceInterests: null }, { deviceInterests: [] })).toEqual([]);
    const d = new Date("2026-09-27T10:00:00.000Z");
    expect(toLogValue(d)).toBe('"2026-09-27T10:00:00.000Z"');
  });
  it("pola pominięte (undefined) nie są zmianą", () => {
    expect(changedFields({ city: "A" }, { city: undefined })).toEqual([]);
  });
});

describe("fromLogValue", () => {
  it("odtwarza wartość z dziennika", () => {
    expect(fromLogValue('"Kraków"')).toBe("Kraków");
    expect(fromLogValue("null")).toBeNull();
    expect(fromLogValue('["COOLTECH"]')).toEqual(["COOLTECH"]);
    expect(fromLogValue(null)).toBeNull();
  });
});
