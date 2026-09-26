import { describe, expect, it } from "vitest";
import { parseManualEntry } from "./manual-entry";

describe("parseManualEntry", () => {
  const ok = { obiekt: "klient", obiekt_id: "c1", operacja: "zmiana_pola", pole: "city", przed: "Krakow", po: "Kraków", zrodlo: "słownik", pewnosc: "wysoka", paczka: "P-1" };
  it("poprawny wpis", () => {
    expect(parseManualEntry(ok)).toEqual({
      ok: true,
      value: { clientId: null, entity: "CLIENT", entityId: "c1", operation: "FIELD_CHANGE", field: "city", before: '"Krakow"', after: '"Kraków"', provenance: { source: "słownik", confidence: "HIGH", batch: "P-1" } },
    });
  });
  it("wartość przed wymagana (null dozwolone)", () => {
    const { przed: _p, ...rest } = ok;
    void _p;
    expect(parseManualEntry(rest).ok).toBe(false);
    expect(parseManualEntry({ ...ok, przed: null })).toMatchObject({ ok: true, value: { before: "null" } });
  });
  it("źródło i pewność wymagane", () => {
    expect(parseManualEntry({ ...ok, zrodlo: "" }).ok).toBe(false);
    expect(parseManualEntry({ ...ok, pewnosc: undefined }).ok).toBe(false);
  });
  it("nieznany obiekt / operacja", () => {
    expect(parseManualEntry({ ...ok, obiekt: "rezerwacja" }).ok).toBe(false);
    expect(parseManualEntry({ ...ok, operacja: "usuniecie" }).ok).toBe(false);
    expect(parseManualEntry({ ...ok, operacja: "SCALENIE" })).toMatchObject({ ok: true, value: { operation: "MERGE" } });
  });
});
