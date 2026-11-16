import { describe, expect, it } from "vitest";
import { classifySms, fold, highlightSegments, matchesQuery, templateRegex } from "./history-rules";

const row = { body: "Potwierdzamy rezerwację: Alma Harmony XL, termin 18.12.2026. Pytania: 531574115", recipient: "+48601234567", clientName: "NK MEDICAL CLINIC NATALIA KUŚNIERZ", rentalLabel: "Alma Harmony (Alma 1)" };

describe("fold", () => {
  it("małe litery bez ogonków, ł → l, długość bez zmian", () => {
    expect(fold("Kuśnierz ŁÓDŹ żółć")).toBe("kusnierz lodz zolc");
    expect(fold("Kuśnierz").length).toBe("Kuśnierz".length);
  });
});

describe("matchesQuery", () => {
  it("data i słowa z treści, bez względu na wielkość liter", () => {
    expect(matchesQuery(row, "18.12.2026")).toBe(true);
    expect(matchesQuery(row, "POTWIERDZAMY")).toBe(true);
    expect(matchesQuery(row, "19.12")).toBe(false);
  });
  it("„kusnierz” znajduje klienta z „Kuśnierz”, także po wynajmie i numerze", () => {
    expect(matchesQuery(row, "kusnierz")).toBe(true);
    expect(matchesQuery(row, "kuśnierz")).toBe(true);
    expect(matchesQuery(row, "alma 1")).toBe(true);
    expect(matchesQuery(row, "601 234 567")).toBe(true);
    expect(matchesQuery(row, "601234")).toBe(true);
    expect(matchesQuery(row, "999")).toBe(false);
  });
  it("pusta fraza = wszystko", () => expect(matchesQuery(row, "  ")).toBe(true));
});

describe("highlightSegments", () => {
  it("zaznacza wszystkie trafienia i zachowuje oryginalny tekst", () => {
    const seg = highlightSegments("Kuśnierz i kusnierz", "KUSNIERZ");
    expect(seg.filter((s) => s.hit).map((s) => s.text)).toEqual(["Kuśnierz", "kusnierz"]);
    expect(seg.map((s) => s.text).join("")).toBe("Kuśnierz i kusnierz");
  });
  it("bez frazy — jeden odcinek", () => expect(highlightSegments("abc", "")).toEqual([{ text: "abc", hit: false }]));
});

describe("classifySms", () => {
  const templates = [
    { label: "Potwierdzenie rezerwacji", body: "Potwierdzamy rezerwację: {rezerwacja_urzadzenie}, termin {rezerwacja_data_start}. Pytania: {telefon_obslugi}" },
    { label: "Brak odbioru", body: "Dzień dobry, dzwoniłam w sprawie wynajmu. Kiedy mogę oddzwonić?" },
  ];
  it("treść z szablonu → szablon (po nazwie)", () => {
    expect(classifySms("Potwierdzamy rezerwację: Alma Harmony XL, termin 18.12.2026. Pytania: 531574115", templates)).toEqual({ kind: "szablon", template: "Potwierdzenie rezerwacji" });
    expect(classifySms("Dzień dobry,  dzwoniłam w sprawie wynajmu. Kiedy mogę oddzwonić?", templates).kind).toBe("szablon");
  });
  it("zmieniona lub własna treść → ręczny", () => {
    expect(classifySms("Potwierdzamy rezerwację: Alma, termin 18.12.2026. Dowóz o 9:00. Pytania: 531574115", templates).kind).toBe("reczny"); // dopisek w szablonie
    expect(classifySms("Dzień dobry, czy pasuje Pani 18.12?", templates)).toEqual({ kind: "reczny", template: null });
  });
  it("templateRegex nie reaguje na znaki specjalne w szablonie", () => {
    expect(templateRegex("Cena: 100 zł (netto)?").test("Cena: 100 zł (netto)?")).toBe(true);
  });
});
