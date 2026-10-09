import { describe, expect, it } from "vitest";
import { outcomeEffect, stageEffectText, stepTypeOptions, whenText } from "./step-edit";

// 6.10.2026 = wtorek.
const now = new Date(2026, 9, 6, 10, 0);
const state = { stage: "WYWIAD" as const, nextStepType: "ODDZWONI", attempts: 0, followUpNo: 0 };

describe("stepTypeOptions", () => {
  it("rodzaje z enuma bez pierwszego kontaktu i powrotu", () => {
    const o = stepTypeOptions("UMOW_TERMIN").map((x) => x.value);
    expect(o).toEqual(["PONOWNA_PROBA", "UMOW_TERMIN", "ODDZWONI", "DOPYTAC", "FOLLOW_UP_OFERTY", "INNE"]);
    expect(stepTypeOptions("UMOW_TERMIN").find((x) => x.value === "INNE")?.label).toBe("kolejny krok");
  });
  it("bieżący rodzaj spoza listy (pierwszy kontakt) zostaje na liście", () => {
    expect(stepTypeOptions("PIERWSZY_KONTAKT")[0]).toEqual({ value: "PIERWSZY_KONTAKT", label: "pierwszy kontakt" });
    expect(stepTypeOptions(null)).toHaveLength(6);
  });
});

describe("whenText", () => {
  it("dziś / jutro / dalej z dniem tygodnia", () => {
    expect(whenText(new Date(2026, 9, 6, 16, 0), now)).toBe("dziś 16:00");
    expect(whenText(new Date(2026, 9, 7, 8, 30), now)).toBe("jutro 8:30");
    expect(whenText(new Date(2026, 9, 12, 10, 0), now)).toMatch(/12\.10, 10:00$/);
  });
});

describe("outcomeEffect — skutek przed zatwierdzeniem (ta sama funkcja co zapis)", () => {
  it("nie odebrała: pierwsza próba → jutro 16:00, druga → jutro 8:30", () => {
    expect(outcomeEffect("no_answer", state, now)).toBe("→ próba 2 (nie odebrała 1×), ponowienie jutro 16:00");
    expect(outcomeEffect("no_answer", { ...state, attempts: 1 }, now)).toBe("→ próba 3 (nie odebrała 2×), ponowienie jutro 8:30");
  });
  it("trzecia nieodebrana → propozycja przegranej", () => {
    expect(outcomeEffect("no_answer", { ...state, attempts: 2 }, now)).toMatch(/próba 3 z 3 bez odebrania/);
  });
  it("follow-up 1 bez odpowiedzi → follow-up 2 z 2", () => {
    expect(outcomeEffect("no_answer", { stage: "OFERTA", nextStepType: "FOLLOW_UP_OFERTY", attempts: 0, followUpNo: 1 }, now)).toMatch(/^→ follow-up 2 z 2, /);
  });
  it("wysłać ofertę → follow-up za 3 dni rob. (10:00)", () => {
    expect(outcomeEffect("offer", state, now)).toMatch(/^→ Oferta wysłana, follow-up .*, 10:00$/);
  });
  it("oddzwoni / później / rezygnuje; booked i brak daty → null", () => {
    expect(outcomeEffect("callback", state, now, { date: "2026-10-09", kind: "ODDZWONI" })).toBe("→ oddzwoni 09.10");
    expect(outcomeEffect("callback", state, now, { date: "2026-10-09", kind: "DOPYTAC" })).toBe("→ dopytać 09.10");
    expect(outcomeEffect("later", state, now, { date: "2026-10-20", postpone: true })).toMatch(/Odłożone do 20\.10/);
    expect(outcomeEffect("later", state, now, { date: "2026-10-20" })).toBe("→ zostaje „W kontakcie”, krok 20.10");
    expect(outcomeEffect("resign", state, now)).toMatch(/Przegrana/);
    expect(outcomeEffect("booked", state, now)).toBeNull();
    expect(outcomeEffect("callback", state, now)).toBeNull();
    expect(outcomeEffect(null, state, now)).toBeNull();
  });
});

describe("stageEffectText", () => {
  it("etap z krokiem i bez", () => {
    expect(stageEffectText("Oferta wysłana", { type: "FOLLOW_UP_OFERTY", at: new Date(2026, 9, 9, 10, 0).toISOString() }, now)).toMatch(/^Oferta wysłana → follow-up oferty, .*10:00\.$/);
    expect(stageEffectText("Wygrana", { type: null, at: null }, now)).toBe("Etap: Wygrana.");
  });
});
