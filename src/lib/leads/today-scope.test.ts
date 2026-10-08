import { describe, expect, it } from "vitest";
import { defaultTodayOwner, lateNote, scopeHint, scopeRows } from "./today-scope";

describe("zakres paska wg roli", () => {
  it("ADMIN i agent → wszyscy, STAFF → moje", () => {
    expect(defaultTodayOwner({ isAdmin: true, readOnly: false })).toBe("all");
    expect(defaultTodayOwner({ isAdmin: false, readOnly: true })).toBe("all");
    expect(defaultTodayOwner({ isAdmin: false, readOnly: false })).toBe("me");
  });
  it("scopeRows: „moje” filtruje po prowadzącej, „wszyscy” zostawia wszystko", () => {
    const rows = [{ id: "1", ownerId: "ania" }, { id: "2", ownerId: "tomek" }, { id: "3", ownerId: null }];
    expect(scopeRows(rows, "me", "ania").map((r) => r.id)).toEqual(["1"]);
    expect(scopeRows(rows, "all", "ania")).toHaveLength(3);
  });
});

describe("notatka o zaległych w kaflu", () => {
  it("brak zaległych → brak linijki; wszystkie; część", () => {
    expect(lateNote(0, 5)).toBeNull();
    expect(lateNote(7, 7)).toBe("7 · wszystkie po terminie");
    expect(lateNote(2, 8)).toBe("2 po terminie");
  });
});

describe("podpowiedź przy pustym „Moje”", () => {
  it("tylko gdy moje = 0 i są sprawy innych", () => {
    expect(scopeHint(0, 22)).toBe("Twoje: 0 · wszystkie: 22");
    expect(scopeHint(0, 0)).toBeNull();
    expect(scopeHint(3, 22)).toBeNull();
  });
});
