import { describe, expect, it } from "vitest";
import { BASE, distanceKm, geoAttempts, geoKey, mapAddress, splitStreet } from "./geo-rules";

describe("mapa klientek — adres i zapytania do Nominatim", () => {
  it("adres dostawy ma pierwszeństwo przed adresem firmy", () => {
    expect(mapAddress({ street: "ul. Rudawska 4", zip: "32-064", city: "Rudawa", deliveryAddress: "ul. Długa 1, 30-001 Kraków" })).toEqual({ street: "ul. Długa 1", zip: "30-001", city: "Kraków" });
    expect(mapAddress({ street: "ul. Rudawska 4", zip: "32-064", city: "Rudawa", deliveryAddress: null })).toEqual({ street: "ul. Rudawska 4", zip: "32-064", city: "Rudawa" });
    expect(mapAddress({ street: "ul. Rudawska 4", zip: null, city: null, deliveryAddress: null })).toBeNull();
    expect(mapAddress({ street: null, zip: "32-064", city: "Rudawa", deliveryAddress: "wjazd od podwórza" })).toEqual({ street: "wjazd od podwórza", zip: "32-064", city: "Rudawa" });
  });

  it("ulica i numer", () => {
    expect(splitStreet("ul. Rudawska 4")).toEqual({ name: "Rudawska", number: "4" });
    expect(splitStreet("Wincentego Witosa 68/4")).toEqual({ name: "Wincentego Witosa", number: "68" });
    expect(splitStreet("Podbory 29a")).toEqual({ name: "Podbory", number: "29a" });
    expect(splitStreet("Rynek")).toEqual({ name: "Rynek", number: null });
  });

  it("kolejność zapytań: adres z kodem → bez kodu → tekst → kod i miasto → miasto", () => {
    const a = geoAttempts({ street: "ul. Rudawska 4", zip: "32-064", city: "Rudawa" });
    expect(a.map((x) => x.params)).toEqual([
      { street: "4 Rudawska", city: "Rudawa", postalcode: "32-064" },
      { street: "4 Rudawska", city: "Rudawa" },
      { q: "Rudawska 4, Rudawa" },
      { postalcode: "32-064", city: "Rudawa" },
      { city: "Rudawa" },
    ]);
    expect(a.map((x) => x.precision)).toEqual(["ADRES", "ADRES", "ADRES", "MIEJSCOWOSC", "MIEJSCOWOSC"]);
    expect(geoAttempts({ street: null, zip: null, city: "Kraków" })).toEqual([{ params: { city: "Kraków" }, precision: "MIEJSCOWOSC" }]);
  });

  it("klucz adresu i odległość od bazy", () => {
    expect(geoKey({ street: "ul. Rudawska 4", zip: "32-064", city: "Rudawa" })).toBe("ul. rudawska 4|32-064|rudawa");
    expect(distanceKm(BASE, { lat: 50.1218371, lng: 19.7118189 })).toBeGreaterThan(16);
    expect(distanceKm(BASE, { lat: 50.1218371, lng: 19.7118189 })).toBeLessThan(18);
  });
});
