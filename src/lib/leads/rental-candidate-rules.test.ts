import { describe, expect, it } from "vitest";
import { nameTokens, parseCandidateQuery } from "./rental-candidate-rules";

describe("Powiąż z wynajmem — wyszukiwarka", () => {
  const now = new Date(2026, 8, 29);
  it("data po polsku, ISO i bez roku (przyszły termin)", () => {
    expect(parseCandidateQuery("06.11", now).date).toEqual(new Date(2026, 10, 6));
    expect(parseCandidateQuery("2026-12-10", now).date).toEqual(new Date(2026, 11, 10));
    expect(parseCandidateQuery("10.02", now).date).toEqual(new Date(2027, 1, 10));
    expect(parseCandidateQuery("AmeLab", now)).toEqual({ date: null, text: "AmeLab" });
  });

  it("słowa nazwy bez ogólników", () => {
    expect(nameTokens("Salon Kosmetyczny AmeLab", "Anna Wierzbicka")).toEqual(["amelab", "anna", "wierzbicka"]);
  });
});
