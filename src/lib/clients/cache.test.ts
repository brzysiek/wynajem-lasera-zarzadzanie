import { describe, expect, it } from "vitest";
import { clientCacheFields, contactCacheFields, formatClientAddress, plainAmount, readablePhone } from "./cache";

describe("format danych kontaktu na wynajmie", () => {
  it("adres w tym samym formacie co z HubSpota", () => {
    expect(formatClientAddress({ street: "ul. Kwiatowa 12", zip: "30-001", city: "Kraków", country: "Polska" })).toBe(
      "ul. Kwiatowa 12, 30-001 Kraków, Polska",
    );
    expect(formatClientAddress({ street: null, zip: null, city: "Kraków", country: null })).toBe("Kraków");
    expect(formatClientAddress({ street: " ", zip: null, city: null, country: null })).toBeNull();
  });

  it("telefon czytelny dla kierowcy", () => {
    expect(readablePhone("+48601000111")).toBe("+48 601 000 111");
    expect(readablePhone("+491701234567")).toBe("+491701234567");
    expect(readablePhone(null)).toBeNull();
  });

  it("kwota bez zbędnych zer", () => {
    expect(plainAmount("150.00")).toBe("150");
    expect(plainAmount("150.50")).toBe("150.5");
    expect(plainAmount(null)).toBeNull();
  });

  it("pola klienta i osoby", () => {
    expect(
      clientCacheFields({ name: "Gabinet Aurora", street: null, zip: null, city: "Kraków", country: "Polska", nip: "6790001122", transportPriceNet: "120.00" }),
    ).toEqual({
      contactCompanyCache: "Gabinet Aurora",
      contactAddressCache: "Kraków, Polska",
      contactNipCache: "6790001122",
      contactTransportPriceCache: "120",
    });
    expect(contactCacheFields({ firstName: "Magdalena", lastName: "Nowicka", phone: "+48601000111", email: "a@b.pl" })).toEqual({
      contactNameCache: "Magdalena Nowicka",
      contactPhoneCache: "+48 601 000 111",
      contactEmailCache: "a@b.pl",
    });
  });
});
