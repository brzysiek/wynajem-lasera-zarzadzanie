import { describe, expect, it } from "vitest";
import { parseDay, parseLeadPatch, parseNewLead } from "./validate";

const deps = { normalizePhone: (raw: string) => (/^\d{9}$/.test(raw.replace(/\s/g, "")) ? `+48${raw.replace(/\s/g, "")}` : null) };

describe("parseLeadPatch", () => {
  it("przegrana wymaga powodu", () => {
    expect(parseLeadPatch({ stage: "PRZEGRANA" }, deps)).toEqual({ ok: false, message: "Wybierz powód przegranej." });
    const r = parseLeadPatch({ stage: "PRZEGRANA", lostReason: "CENA", lostNote: " za drogo ", returnAt: "2027-02-01" }, deps);
    expect(r.ok && r.data).toMatchObject({ stage: "PRZEGRANA", lostReason: "CENA", lostNote: "za drogo" });
    expect(r.ok && r.data.returnAt?.getMonth()).toBe(1);
  });

  it("tylko przesłane pola, walidacja telefonu i dni", () => {
    expect(parseLeadPatch({ nextActionAt: "2026-09-28" }, deps)).toMatchObject({ ok: true });
    expect(parseLeadPatch({ contactPhone: "601 000 111" }, deps)).toEqual({ ok: true, data: { contactPhone: "+48601000111" } });
    expect(parseLeadPatch({ contactPhone: "12" }, deps).ok).toBe(false);
    expect(parseLeadPatch({ requestedDays: 0 }, deps).ok).toBe(false);
    expect(parseLeadPatch({ deviceInterest: ["LASER"] }, deps).ok).toBe(false);
    expect(parseLeadPatch({ stage: "XYZ" }, deps).ok).toBe(false);
  });

  it("parseDay", () => {
    expect(parseDay("")).toBeNull();
    expect(parseDay("abc")).toBeUndefined();
    expect(parseDay("2026-09-28")?.getDate()).toBe(28);
  });
});

describe("parseNewLead", () => {
  it("wymaga klienta albo danych osoby", () => {
    expect(parseNewLead({ type: "TELEFON" }, deps).ok).toBe(false);
    expect(parseNewLead({ type: "TELEFON", clientId: "c1" }, deps)).toMatchObject({ ok: true, data: { clientId: "c1", type: "TELEFON" } });
    expect(parseNewLead({ contactName: "Anna", contactPhone: "601000111" }, deps)).toMatchObject({
      ok: true,
      data: { type: "TELEFON", contactName: "Anna", contactPhone: "+48601000111" },
    });
  });
});
