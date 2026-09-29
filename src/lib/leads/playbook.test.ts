import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYBOOK, fillScript, nextReward, parsePlaybook, rewardUnlockedAt } from "./playbook";

describe("ściąga (złote zasady)", () => {
  it("brak / zły JSON → domyślna; częściowy zapis uzupełniony domyślnymi", () => {
    expect(parsePlaybook(null)).toEqual(DEFAULT_PLAYBOOK);
    expect(parsePlaybook("{zly")).toEqual(DEFAULT_PLAYBOOK);
    const p = parsePlaybook(JSON.stringify({ season: { target: 10, reward: "weekend" }, rules: [{ title: "Jedna zasada", text: "opis" }] }));
    // Zapis sprzed wniosku 21 (cel „8 z nowych”) → nowy cel sezonu w całości.
    expect(p.season).toEqual(DEFAULT_PLAYBOOK.season);
    expect(p.rules).toEqual([{ title: "Jedna zasada", text: "opis" }]);
    expect(p.questions).toHaveLength(6);
  });

  it("cel sezonu (wniosek 21): 12 + 8 = 20, nagroda co 5 z opisem progu", () => {
    const p = parsePlaybook(JSON.stringify({ season: { returningTarget: 12, newTarget: 8, rewards: ["kino", "kolacja", "weekend"] } }));
    expect(p.season).toMatchObject({ target: 20, from: "2026-10-01", to: "2027-05-31", milestone: "2026-11-15", rewards: ["kino", "kolacja", "weekend", "weekend"], reward: "kino" });
    expect(nextReward(3, p.season)).toEqual({ at: 5, left: 2, text: "kino" });
    expect(nextReward(5, p.season)).toEqual({ at: 10, left: 5, text: "kolacja" });
    expect(nextReward(20, p.season)).toBeNull();
    expect(rewardUnlockedAt(5, p.season)).toBe("kino");
    expect(rewardUnlockedAt(15, p.season)).toBe("weekend");
    expect(rewardUnlockedAt(6, p.season)).toBeNull();
  });


  it("skrypt z wolnym terminem", () => {
    expect(fillScript("trzymam {termin}", { termin: "16.10" })).toBe("trzymam 16.10");
    expect(fillScript("trzymam {termin}", {})).toBe("trzymam [termin]");
  });
});
