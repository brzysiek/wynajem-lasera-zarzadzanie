import { describe, expect, it } from "vitest";
import { SETTINGS_GROUPS, accessForPath, canSeeSettings, findItem, homeFor, itemAccess } from "./settings-nav";

describe("Ustawienia — 6 grup (wniosek 55)", () => {
  it("sześć grup w ustalonej kolejności, z pozycjami z wniosku", () => {
    expect(SETTINGS_GROUPS.map((g) => g.title)).toEqual(["Oferta", "Zapytania i skrzynka", "SMS", "Flota i koszty", "Marketing", "System"]);
    const labels = SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.label));
    for (const l of ["Cennik", "Ściąga", "Maile automatyczne", "Formularze WWW → sygnały", "Maile → sygnały", "Wykluczenia maili", "Messenger / Instagram", "Szablony", "Przypomnienia", "Pojazdy", "Kategorie kosztów", "Konwersje Google Ads", "Użytkownicy", "Integracje", "Importy historii"]) {
      expect(labels).toContain(l);
    }
    expect(new Set(SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.href))).size).toBe(labels.length);
  });
});

describe("uprawnienia: ADMIN edytuje wszystko, STAFF poza Użytkownikami, Integracjami i Importami tylko podgląd", () => {
  const restricted = SETTINGS_GROUPS.flatMap((g) => g.items).filter((i) => i.restricted).map((i) => i.href);
  it("pozycje tylko do podglądu dla STAFF", () => {
    expect(restricted.sort()).toEqual(["/ustawienia/importy", "/ustawienia/integracje", "/ustawienia/messenger-instagram", "/ustawienia/uzytkownicy"]);
  });
  it("dostęp zależy od roli", () => {
    for (const g of SETTINGS_GROUPS) {
      for (const i of g.items) {
        expect(itemAccess(i, "ADMIN")).toBe("edit");
        expect(itemAccess(i, "STAFF")).toBe(i.restricted ? "view" : "edit");
        expect(itemAccess(i, "KIEROWCA")).toBe("none");
        expect(itemAccess(i, "AGENT")).toBe("none");
      }
    }
  });
  it("podstrony pozycji dziedziczą dostęp; przegląd dostępny dla obu ról", () => {
    expect(accessForPath("/ustawienia/integracje/google", "STAFF")).toBe("view");
    expect(accessForPath("/ustawienia/cennik", "STAFF")).toBe("edit");
    expect(accessForPath("/ustawienia/przeglad", "STAFF")).toBe("edit");
    expect(accessForPath("/ustawienia/cennik", null)).toBe("none");
    expect(findItem("/ustawienia/integracje/hubspot")?.item.label).toBe("Integracje");
    expect(canSeeSettings("STAFF")).toBe(true);
    expect(canSeeSettings("KIEROWCA")).toBe(false);
  });
  it("strona startowa: ADMIN przegląd, STAFF grupa SMS", () => {
    expect(homeFor("ADMIN")).toBe("/ustawienia/przeglad");
    expect(homeFor("STAFF")).toBe("/ustawienia/przypomnienia-sms");
  });
});
