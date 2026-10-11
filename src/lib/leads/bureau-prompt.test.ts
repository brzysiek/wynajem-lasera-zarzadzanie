import { describe, expect, it } from "vitest";
import { buildBureauPrompt, bureauDescription, formatStepTerm, type BureauInput } from "./bureau-prompt";

const base: BureauInput = {
  id: "d51a0f52-bbe4-11f1-8291-1070fd283b8e",
  name: "MG Beauty",
  city: "Kraków",
  stageLabel: "W kontakcie",
  stepType: "UMOW_TERMIN",
  stepNote: "woli telefon po 15:00",
  stepAt: new Date(2026, 9, 16, 9, 0),
  devices: ["Alma"],
  dates: "20–24.10",
  followUpNo: 0,
  returnAt: null,
};

describe("buildBureauPrompt", () => {
  it("zawiera id, gabinet, etap, krok z terminem, rodzaj wiadomości i cel", () => {
    const p = buildBureauPrompt("OFERTA_MAIL", base);
    expect(p).toContain("BIURO · MG Beauty: napisz mail z ofertą do klientki.");
    expect(p).toContain("d51a0f52-bbe4-11f1-8291-1070fd283b8e");
    expect(p).toContain("MG Beauty, Kraków");
    expect(p).toContain("etap: W kontakcie");
    expect(p).toContain("następny krok: umówić termin — woli telefon po 15:00, 16.10, 09:00");
    expect(p).toContain("Urządzenie i termin: Alma, 20–24.10.");
    expect(p).toContain("Cel: wyślij ofertę z dwoma wolnymi terminami i ceną z transportem.");
    expect(p).toContain("szkic w Gmailu");
  });

  it("pomija puste pola (miasto, krok, urządzenie)", () => {
    const p = buildBureauPrompt("FOLLOW_UP_MAIL", { ...base, city: null, stepType: null, stepNote: null, stepAt: null, devices: [], dates: null, stageLabel: "Oferta wysłana", followUpNo: 1 });
    expect(p).not.toContain("następny krok");
    expect(p).not.toContain("Urządzenie i termin");
    expect(p).toContain("Sygnał: d51a0f52-bbe4-11f1-8291-1070fd283b8e · MG Beauty · etap: Oferta wysłana.");
    expect(p).toContain("follow-up oferty (1 z 2)");
  });

  it("SMS: bez zapisu szkicu w Gmailu, z telefonem Ani", () => {
    const p = buildBureauPrompt("SMS_NIEODEBRANY", base);
    expect(p).toContain("napisz SMS po nieodebranym połączeniu");
    expect(p).toContain("531 574 115");
    expect(p).not.toContain("szkic w Gmailu");
  });

  it("skraca bardzo długą notatkę kroku", () => {
    const p = buildBureauPrompt("OFERTA_MAIL", { ...base, stepNote: "x".repeat(900) });
    expect(p.length).toBeLessThan(900);
  });

  it("nie przyjmuje treści maili — wejście nie ma takiego pola", () => {
    const keys = Object.keys(base);
    expect(keys.some((k) => /mail|body|message|tre/i.test(k))).toBe(false);
  });
});

describe("bureauDescription", () => {
  it("opisuje merytorycznie bez treści promptu", () => {
    const t = bureauDescription("OFERTA_MAIL", base);
    expect(t).toContain("Zapytanie dotyczy: Alma, 20–24.10.");
    expect(t).not.toContain("BIURO ·");
  });
  it("follow-up 2 z 2", () => {
    expect(bureauDescription("FOLLOW_UP_MAIL", { ...base, followUpNo: 2 })).toContain("follow-up 2 z 2");
  });
  it("formatStepTerm: pełna godzina albo sama data", () => {
    expect(formatStepTerm(new Date(2026, 9, 16, 0, 0))).toBe("16.10");
    expect(formatStepTerm(new Date(2026, 9, 16, 9, 5))).toBe("16.10, 09:05");
  });
});
