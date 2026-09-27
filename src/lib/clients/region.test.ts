import { describe, expect, it } from "vitest";
import { computeRegion, regionFromCity, regionFromZip } from "./region";

describe("region z kodu pocztowego i miasta", () => {
  it("kody pocztowe", () => {
    expect(regionFromZip("30-001")).toBe("KRAKOWSKI");
    expect(regionFromZip("32-064")).toBe("KRAKOWSKI"); // Rudawa
    expect(regionFromZip("32-020")).toBe("KRAKOWSKI"); // Wieliczka
    expect(regionFromZip("34-730")).toBe("MALOPOLSKA"); // Mszana Dolna
    expect(regionFromZip("34-120")).toBe("MALOPOLSKA"); // Andrychów
    expect(regionFromZip("34-300")).toBe("SLASK"); // Żywiec
    expect(regionFromZip("38-300")).toBe("MALOPOLSKA"); // Gorlice
    expect(regionFromZip("35-001")).toBe("PODKARPACIE");
    expect(regionFromZip("43-400")).toBe("SLASK"); // Cieszyn
    expect(regionFromZip("28-100")).toBe("SWIETOKRZYSKIE"); // Busko-Zdrój (La Skin Clinic)
    expect(regionFromZip("00-001")).toBe("INNE");
    expect(regionFromZip("brak")).toBeNull();
  });

  it("bez kodu — z miasta, także z wolnego tekstu", () => {
    expect(regionFromCity("Wieliczka / Kraków: Żabiniec/Sarmacka")).toBe("KRAKOWSKI");
    expect(regionFromCity("Busko-Zdrój")).toBe("SWIETOKRZYSKIE");
    expect(regionFromCity("Lesko, Brzozów")).toBe("PODKARPACIE");
    expect(regionFromCity("okolice Łodzi")).toBeNull();
    expect(computeRegion(null, "okolice Łodzi")).toBe("INNE");
    expect(computeRegion("28-100", "Kraków")).toBe("SWIETOKRZYSKIE"); // kod wygrywa
  });
});
