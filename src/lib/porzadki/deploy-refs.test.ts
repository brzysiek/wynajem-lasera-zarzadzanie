import { describe, expect, it } from "vitest";
import { latestDeployByNumber, proposalNumbersIn } from "./deploy-refs";

describe("proposalNumbersIn", () => {
  it("zakres i lista", () => {
    expect(proposalNumbersIn("Wnioski 24–27 (część 2): Na dziś, karta sygnału")).toEqual([24, 25, 26, 27]);
    expect(proposalNumbersIn("Wnioski 26 i 24 (część 1): porządek w zadaniach")).toEqual([24, 26]);
    expect(proposalNumbersIn("Wniosek 23: klient rezerwacji wybierany w panelu")).toEqual([23]);
  });
  it("nawiasy i słowa kończą listę", () => {
    expect(proposalNumbersIn("Wnioski 20 (dziennik), 21 (pula wiosny), 22 (powiązania zadań) i uwagi 18 a–d")).toEqual([20, 21, 22]);
    expect(proposalNumbersIn("Cel sezonu 20 gabinetów: 12 wracających z wiosny + 8 nowych (wniosek 21)")).toEqual([21]);
    expect(proposalNumbersIn("Sygnały przed wejściem Ani + status klienta z przyjazdów (wniosek 20)")).toEqual([20]);
  });
  it("bez numerów", () => {
    expect(proposalNumbersIn("Poprawka stopki")).toEqual([]);
    expect(proposalNumbersIn("Wnioski o zmiany: lista")).toEqual([]);
  });
});

describe("latestDeployByNumber", () => {
  it("najnowszy commit wygrywa", () => {
    const m = latestDeployByNumber([
      { hash: "e902775", at: "2026-09-29T19:30:00Z", subject: "Wnioski 24–27 (część 2): x" },
      { hash: "c1a1786", at: "2026-09-29T17:00:00Z", subject: "Wnioski 26 i 24 (część 1): y" },
    ]);
    expect(m.get(26)?.hash).toBe("e902775");
    expect(m.get(25)?.hash).toBe("e902775");
  });
});
