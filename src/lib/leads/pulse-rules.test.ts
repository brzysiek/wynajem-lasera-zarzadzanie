import { describe, expect, it } from "vitest";
import { classifyActivity, classifyOutMail, median, periodBounds } from "./pulse-rules";

describe("classifyActivity", () => {
  it("kontakty tylko od ludzi", () => {
    expect(classifyActivity({ type: "CALL", body: "rozmowa", userRole: "ADMIN" })).toEqual({ kind: "kontakt", human: true, auto: false });
    expect(classifyActivity({ type: "NOTE", body: "porządek", userRole: "AGENT" }).kind).toBeNull();
    expect(classifyActivity({ type: "NOTE", body: "porządek", userRole: "AGENT" }).auto).toBe(true);
    expect(classifyActivity({ type: "SYSTEM", body: "Następny krok: dopytać", userRole: "ADMIN" }).kind).toBeNull();
  });
  it("zmiany etapu", () => {
    expect(classifyActivity({ type: "STAGE_CHANGE", body: "W kontakcie → Oferta wysłana", userRole: "ADMIN" }).kind).toBe("oferta");
    expect(classifyActivity({ type: "STAGE_CHANGE", body: "auto · mail z ofertą: „x” → Oferta wysłana · y", userRole: null }).kind).toBe("oferta");
    expect(classifyActivity({ type: "STAGE_CHANGE", body: "W kontakcie → Oferta wysłana", userRole: "AGENT" }).kind).toBeNull();
    expect(classifyActivity({ type: "STAGE_CHANGE", body: "Oferta wysłana → Przegrana · powód: Inne", userRole: "ADMIN" }).kind).toBe("przegrana");
    expect(classifyActivity({ type: "STAGE_CHANGE", body: "W kontakcie → Przegrana · powód: Tylko cennik", userRole: "AGENT" }).kind).toBeNull();
    expect(classifyActivity({ type: "STAGE_CHANGE", body: "W kontakcie → Odłożone", userRole: "ADMIN" }).kind).toBe("odlozone");
  });
  it("rezerwacje z kalendarza zawsze", () => {
    expect(classifyActivity({ type: "SYSTEM", body: "Rezerwacja w kalendarzu: LightSheer QUATTRO 05.11 · etap: Rezerwacja", userRole: null }).kind).toBe("rez");
    expect(classifyActivity({ type: "SYSTEM", body: "Powiązano z rezerwacją: LightSheer QUATTRO, 24.10.2026", userRole: null }).kind).toBe("rez");
    expect(classifyActivity({ type: "STAGE_CHANGE", body: "Rezerwacja w kalendarzu: Observ 520x 06.11", userRole: null }).kind).toBe("rez");
    expect(classifyActivity({ type: "NOTE", body: "Rezerwacja w kalendarzu „Lubartów”", userRole: "AGENT" }).kind).toBeNull();
  });
});

describe("classifyOutMail", () => {
  it("automatyczny cennik to nie kontakt", () => {
    expect(classifyOutMail("Cennik oraz aktualna oferta - wynajemlasera.pl")).toEqual({ contact: false, offer: false, auto: true });
    expect(classifyOutMail("Wstępna rezerwacja sprzętu WynajemLasera.pl")).toEqual({ contact: false, offer: false, auto: true });
    expect(classifyOutMail("Otrzymaliśmy Twoją rezerwację — WynajemLasera.pl")).toEqual({ contact: false, offer: false, auto: true });
    expect(classifyOutMail("Otrzymalismy Twoja rezerwacje - WynajemLasera.pl").auto).toBe(false); // inna treść = nie automat
    // Odpowiedź Ani w wątku automatu to kontakt człowieka.
    expect(classifyOutMail("Re: Otrzymaliśmy Twoją rezerwację — WynajemLasera.pl").contact).toBe(true);
    expect(classifyOutMail("Re: Cennik oraz aktualna oferta - wynajemlasera.pl").contact).toBe(true);
    expect(classifyOutMail("Wynajemlasera – Oferta na sezon 2026/2027")).toEqual({ contact: true, offer: true, auto: false });
    expect(classifyOutMail("Re: Alma harmony").offer).toBe(false);
  });
});

describe("periodBounds / median", () => {
  it("tydzień od poniedziałku", () => {
    const b = periodBounds("week", new Date(2026, 8, 30, 15, 0));
    expect(b.from.getDate()).toBe(28);
    expect(b.prevFrom.getDate()).toBe(21);
    expect(periodBounds("7", new Date(2026, 8, 30, 15, 0)).from.getDate()).toBe(24);
  });
  it("mediana", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
