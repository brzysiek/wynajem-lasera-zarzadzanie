import { describe, expect, it } from "vitest";
import { parseProvenance } from "./provenance";

describe("parseProvenance", () => {
  it("wymagane dla agenta: źródło i pewność", () => {
    expect(parseProvenance({}, { required: true })).toEqual({ ok: false, message: "Podaj źródło zmiany (np. mail, faktura, rejestr)." });
    expect(parseProvenance({ zrodlo: "Biała lista" }, { required: true }).ok).toBe(false);
    expect(parseProvenance({ zrodlo: "Biała lista", pewnosc: "wysoka", paczka: "P-2026-09-27-01" }, { required: true })).toEqual({
      ok: true,
      value: { source: "Biała lista", confidence: "HIGH", batch: "P-2026-09-27-01" },
    });
  });
  it("klucze z formularza panelu", () => {
    expect(parseProvenance({ changeSource: " mail ", changeConfidence: "MEDIUM" }, { required: true })).toEqual({
      ok: true,
      value: { source: "mail", confidence: "MEDIUM", batch: null },
    });
  });
  it("„source” to pole klienta, nie źródło zmiany", () => {
    expect(parseProvenance({ source: "TELEFON" }, { required: true }).ok).toBe(false);
  });
  it("opcjonalne dla biura, ale pewność musi być poprawna", () => {
    expect(parseProvenance({}, { required: false })).toEqual({ ok: true, value: { source: null, confidence: null, batch: null } });
    expect(parseProvenance({ pewnosc: "bardzo" }, { required: false }).ok).toBe(false);
    expect(parseProvenance({ pewnosc: "Średnia" }, { required: false })).toMatchObject({ ok: true, value: { confidence: "MEDIUM" } });
  });
});
