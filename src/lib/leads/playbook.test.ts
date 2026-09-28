import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYBOOK, fillScript, parsePlaybook, seasonReservations } from "./playbook";

describe("ściąga (złote zasady)", () => {
  it("brak / zły JSON → domyślna; częściowy zapis uzupełniony domyślnymi", () => {
    expect(parsePlaybook(null)).toEqual(DEFAULT_PLAYBOOK);
    expect(parsePlaybook("{zly")).toEqual(DEFAULT_PLAYBOOK);
    const p = parsePlaybook(JSON.stringify({ season: { target: 10, reward: "weekend" }, rules: [{ title: "Jedna zasada", text: "opis" }] }));
    expect(p.season).toEqual({ target: 10, from: "2026-09-01", to: "2027-05-31", reward: "weekend" });
    expect(p.rules).toEqual([{ title: "Jedna zasada", text: "opis" }]);
    expect(p.questions).toHaveLength(6);
  });

  it("cel sezonu: rezerwacje z nowych zapytań w sezonie", () => {
    const s = DEFAULT_PLAYBOOK.season;
    const d = (m: number, day: number) => new Date(2026, m - 1, day);
    expect(
      seasonReservations(
        [
          { createdAt: d(9, 10), stage: "REZERWACJA", rentalId: "r" },
          { createdAt: d(9, 12), stage: "WYGRANA", rentalId: "r2" },
          { createdAt: d(9, 15), stage: "REZERWACJA", rentalId: null, returningClient: true },
          { createdAt: d(8, 20), stage: "WYGRANA", rentalId: "r3" },
          { createdAt: d(9, 20), stage: "OFERTA", rentalId: null },
        ],
        s,
      ),
    ).toBe(2);
  });

  it("skrypt z wolnym terminem", () => {
    expect(fillScript("trzymam {termin}", { termin: "16.10" })).toBe("trzymam 16.10");
    expect(fillScript("trzymam {termin}", {})).toBe("trzymam [termin]");
  });
});
