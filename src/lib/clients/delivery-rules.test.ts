import { describe, expect, it } from "vitest";
import { formatAddressLine, parseAddressInput, parseBase, parseZones, routeLabel, sameAddress, splitFeedback, zoneFor, DEFAULT_BASE } from "./delivery-rules";
import { computeRegion, regionFromGeo } from "./region";

describe("paszport dostawy", () => {
  it("adres w jednej linii i porównanie bez „ul.” i wielkości liter", () => {
    expect(formatAddressLine({ street: "ul. Krakowska 137", zip: "32-060", city: "Liszki" })).toBe("ul. Krakowska 137, 32-060 Liszki");
    expect(formatAddressLine({ street: null, zip: null, city: "Wieliczka" })).toBe("Wieliczka");
    expect(sameAddress({ street: "ul. Orkana 80", zip: "34-730", city: "Mszana Dolna" }, { street: "Orkana 80", zip: "34-730", city: "mszana dolna" })).toBe(true);
    expect(sameAddress({ street: "Orkana 80", zip: "34-730", city: "Mszana Dolna" }, { street: "Orkana 8", zip: "34-730", city: "Mszana Dolna" })).toBe(false);
  });

  it("strefy: granice stałe, stawki z ustawień; 10 km to już strefa B", () => {
    const zones = parseZones(JSON.stringify({ A: 50, B: "70", C: "", D: -5 }));
    expect(zones.map((z) => z.priceNet)).toEqual([50, 70, null, null, null]);
    expect(zoneFor(8, zones)?.code).toBe("A");
    expect(zoneFor(10, zones)?.code).toBe("B");
    expect(zoneFor(58.6, zones)?.code).toBe("C");
    expect(zoneFor(140, zones)?.code).toBe("E");
    expect(zoneFor(null, zones)).toBeNull();
    expect(parseZones("zepsute").every((z) => z.priceNet === null)).toBe(true);
  });

  it("baza z ustawień albo domyślna Podbory 29a", () => {
    expect(parseBase(null)).toEqual(DEFAULT_BASE);
    expect(parseBase(JSON.stringify({ address: "X", lat: 50, lng: 20 }))).toEqual({ address: "X", lat: 50, lng: 20 });
    expect(parseBase(JSON.stringify({ address: "X" }))).toEqual(DEFAULT_BASE);
  });

  it("etykieta trasy", () => {
    expect(routeLabel(8.4, 10.2)).toBe("8 km · 10 min");
    expect(routeLabel(58.6, 55.9)).toBe("59 km · 56 min");
    expect(routeLabel(140, 125)).toBe("140 km · 2 h 05 min");
    expect(routeLabel(12, null)).toBe("12 km");
    expect(routeLabel(null, 5)).toBeNull();
  });

  it("region z województwa i powiatu — wieś nie wpada do „Inne”", () => {
    expect(regionFromGeo("województwo małopolskie", "powiat krakowski")).toBe("KRAKOWSKI");
    expect(regionFromGeo("województwo małopolskie", "powiat wielicki")).toBe("KRAKOWSKI");
    expect(regionFromGeo("województwo małopolskie", "Kraków")).toBe("KRAKOWSKI");
    expect(regionFromGeo("województwo małopolskie", "powiat limanowski")).toBe("MALOPOLSKA");
    expect(regionFromGeo("województwo śląskie", "powiat bielski")).toBe("SLASK");
    expect(regionFromGeo("województwo podkarpackie", null)).toBe("PODKARPACIE");
    expect(regionFromGeo("województwo świętokrzyskie", null)).toBe("SWIETOKRZYSKIE");
    expect(regionFromGeo("województwo mazowieckie", null)).toBe("INNE");
    expect(regionFromGeo(null, null)).toBeNull();
    // Kod pocztowy dalej pierwszy; bez kodu — geokodowanie przed słownikiem miast.
    expect(computeRegion(null, "Kasina Wielka", { state: "województwo małopolskie", county: "powiat limanowski" })).toBe("MALOPOLSKA");
    expect(computeRegion(null, "Kasina Wielka")).toBe("INNE");
    expect(computeRegion("34-730", "Mszana Dolna", { state: "województwo śląskie", county: null })).toBe("MALOPOLSKA");
  });

  it("zapis adresu: normalizacja, wymagane miejsce, godzina", () => {
    const r = parseAddressInput({ label: "Wieliczka", street: "Asnyka 5, 32020 Wieliczka", entrance: "  od podwórza " }, null);
    expect(r.ok && r.value).toMatchObject({ label: "Wieliczka", street: "Asnyka 5", zip: "32-020", city: "Wieliczka", entrance: "od podwórza" });
    expect(parseAddressInput({ label: "X", street: "Asnyka 5" }, null)).toMatchObject({ ok: false });
    expect(parseAddressInput({ label: "", city: "Kraków" }, null)).toMatchObject({ ok: false });
    expect(parseAddressInput({ city: "Kraków", usualStartTime: "25:00" }, null)).toMatchObject({ ok: false });
    const t = parseAddressInput({ city: "Kraków", usualStartTime: "9.30" }, null);
    expect(t.ok && t.value.usualStartTime).toBe("09:30");
  });

  it("zmiana samych uwag nie sprawdza starego adresu; lista zmienionych pól", () => {
    const legacy = parseAddressInput({ city: "Wieliczka" }, null);
    if (!legacy.ok) throw new Error();
    const current = { ...legacy.value, city: "Wieliczka / Kraków: Żabiniec", zip: "32020" };
    const r = parseAddressInput({ officeNotes: "Dzwonić 15 min przed" }, current);
    expect(r.ok && r.changed).toEqual(["officeNotes"]);
  });

  it("uwagi kierowcy: 3 na wierzchu, reszta pod „więcej”", () => {
    expect(splitFeedback([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], more: [4, 5] });
    expect(splitFeedback([1])).toEqual({ shown: [1], more: [] });
  });
});
