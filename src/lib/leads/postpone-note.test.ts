import { describe, expect, it } from "vitest";
import { postponeAddendum, postponeStepNote, previousStepNote, returnStepNote } from "./postpone-note";

describe("notatka kroku przy odłożeniu i powrocie", () => {
  const prev = "Zadzwonić 16.10 z 2 wolnymi terminami";
  it("odłożenie zachowuje poprzednią notatkę i dopisek", () => {
    expect(postponeStepNote({ reasonLabel: "inny powód", note: null, previous: prev })).toBe(`wraca: inny powód. Wcześniej: ${prev}`);
    expect(postponeStepNote({ reasonLabel: "urlop", note: "wróci 20.10", previous: prev })).toBe(`wraca: urlop — wróci 20.10. Wcześniej: ${prev}`);
    expect(postponeStepNote({ reasonLabel: "urlop", note: null, previous: null })).toBe("wraca: urlop");
  });
  it("poprzednia notatka z kroku POWROT i ze zwykłego kroku", () => {
    expect(previousStepNote("INNE", prev)).toBe(prev);
    expect(previousStepNote("POWROT", `wraca: inny powód. Wcześniej: ${prev}`)).toBe(prev);
    expect(previousStepNote("POWROT", "wraca: inny powód")).toBeNull();
    expect(previousStepNote("INNE", null)).toBeNull();
  });
  it("ponowne odłożenie nie zagnieżdża znacznika", () => {
    const first = postponeStepNote({ reasonLabel: "urlop", note: null, previous: prev });
    const again = postponeStepNote({ reasonLabel: "remont / otwarcie", note: null, previous: previousStepNote("POWROT", first) });
    expect(again).toBe(`wraca: remont / otwarcie. Wcześniej: ${prev}`);
  });
  it("powrót: notatka kroku wraca razem z dopiskiem", () => {
    const note = postponeStepNote({ reasonLabel: "urlop", note: "wróci 20.10", previous: prev });
    expect(postponeAddendum(note)).toBe("wróci 20.10");
    const back = returnStepNote({ why: "urlop", postponeNote: note });
    expect(back).toBe(`wraca z odłożonych (urlop) — zapytać o decyzję · wróci 20.10. Wcześniej: ${prev}`);
    expect(back.startsWith("wraca z odłożonych")).toBe(true); // „Na dziś” rozpoznaje powrót po tym prefiksie
  });
  it("powrót bez poprzedniej notatki (stare odłożenia) działa jak dotąd", () => {
    expect(returnStepNote({ why: "przed sezonem", postponeNote: "wraca: przed sezonem" })).toBe("wraca z odłożonych (przed sezonem) — zapytać o decyzję");
    expect(returnStepNote({ why: null, postponeNote: null })).toBe("wraca z odłożonych — zapytać o decyzję");
  });
  it("skraca bardzo długą poprzednią notatkę", () => {
    expect(postponeStepNote({ reasonLabel: "x", note: null, previous: "a".repeat(900) }).length).toBeLessThan(450);
  });
});
