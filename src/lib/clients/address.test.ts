import { describe, expect, it } from "vitest";
import { addressError, normalizeAddress, normalizeAddressPatch } from "./address";

const a = (street: string | null, zip: string | null = null, city: string | null = null, country: string | null = null) => normalizeAddress({ street, zip, city, country });

describe("format adresu (wniosek 11)", () => {
  it("numer przed ulicą (HubSpot) → ulica numer", () => {
    expect(a("51 Urzędnicza").street).toBe("Urzędnicza 51");
    expect(a("12/4 Długa").street).toBe("Długa 12/4");
    expect(a("ul. 3 Maja 5").street).toBe("ul. 3 Maja 5");
    expect(a("11 Listopada").street).toBe("11 Listopada");
  });

  it("kod i miasto w polu ulica albo miasto", () => {
    expect(a("Urzędnicza 51, 30-048 Kraków")).toEqual({ street: "Urzędnicza 51", zip: "30-048", city: "Kraków", country: null });
    expect(a("Orkana 80 34730 Mszana Dolna, Poland")).toMatchObject({ street: "Orkana 80", zip: "34-730", city: "Mszana Dolna" });
    expect(a(null, null, "28-100 Busko-Zdrój")).toMatchObject({ zip: "28-100", city: "Busko-Zdrój" });
  });

  it("słownik: Poland, Krakow, Warsaw", () => {
    expect(a("Długa 1", "30001", "Krakow", "Poland")).toEqual({ street: "Długa 1", zip: "30-001", city: "Kraków", country: "Polska" });
    expect(a(null, null, "Warsaw").city).toBe("Warszawa");
  });

  it("wpisany kod nie jest nadpisywany kodem z ulicy", () => {
    expect(a("Długa 1, 30-002 Kraków", "30-001", "Kraków")).toMatchObject({ street: "Długa 1", zip: "30-001", city: "Kraków" });
  });

  it("walidacja: kod NN-NNN (Polska), miasto bez cyfr", () => {
    expect(addressError({ street: null, zip: "3000", city: "Kraków", country: "Polska" })).toContain("NN-NNN");
    expect(addressError({ street: null, zip: "1010", city: "Wien", country: "Austria" })).toBeNull();
    expect(addressError({ street: null, zip: null, city: "Kraków 2", country: null })).toContain("cyfr");
    expect(addressError(a("Urzędnicza 51, 30-048 Kraków"))).toBeNull();
  });
});

describe("zapis klienta — normalizeAddressPatch", () => {
  const current = { street: null, zip: null, city: "Kraków", country: "Polska" };
  it("kod z pola ulica trafia do pola kod", () => {
    const r = normalizeAddressPatch({ street: "Urzędnicza 51, 30-048 Kraków" }, current);
    expect(r).toEqual({ ok: true, patch: { street: "Urzędnicza 51", zip: "30-048" } });
  });
  it("bez pól adresu — bez zmian; zły kod — błąd", () => {
    expect(normalizeAddressPatch({ name: "X" } as never, current)).toEqual({ ok: true, patch: { name: "X" } });
    expect(normalizeAddressPatch({ zip: "300" }, current)).toMatchObject({ ok: false });
  });
});
