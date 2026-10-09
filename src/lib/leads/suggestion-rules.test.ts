import { describe, expect, it } from "vitest";
import { countNewEntries, isDraftNoise, isRequestPending, rankWork, suggestionReasons, validateSuggestionText } from "./suggestion-rules";

describe("validateSuggestionText", () => {
  it("1–400 znaków zwykłego tekstu", () => {
    expect(validateSuggestionText("Sugeruję zadzwonić po 15:00.")).toBeNull();
    expect(validateSuggestionText("x".repeat(400))).toBeNull();
  });
  it("puste, za długie i HTML odrzucone", () => {
    expect(validateSuggestionText("  ")).toMatch(/pusta/);
    expect(validateSuggestionText("x".repeat(401))).toMatch(/400/);
    expect(validateSuggestionText("Sugeruję <b>zadzwonić</b>")).toMatch(/HTML/);
    expect(validateSuggestionText("a < b i c > d, 2 < 3")).toBeNull(); // znaki mniejszości bez znacznika to nie HTML
  });
});

describe("nowe wpisy od sugestii", () => {
  const covered = new Date("2026-10-09T07:30:00Z");
  it("liczy tylko nowsze; praca przy szkicu maila nie unieważnia sugestii", () => {
    const entries = [
      { at: new Date("2026-10-09T07:00:00Z"), type: "CALL", body: "stary" },
      { at: new Date("2026-10-09T08:00:00Z"), type: "EMAIL", body: "mail od klientki" },
      { at: new Date("2026-10-09T09:00:00Z"), type: "SYSTEM", body: "Szkic odpowiedzi przygotowany przez agenta" },
      { at: new Date("2026-10-09T09:05:00Z"), type: "SYSTEM", body: "Szkic odpowiedzi zapisany w Gmailu: Re: X" },
      { at: new Date("2026-10-09T10:00:00Z"), type: "SYSTEM", body: "Wysłano odpowiedź ze szkicu: Re: X" },
      { at: new Date("2026-10-09T11:00:00Z"), type: "STAGE_CHANGE", body: "Nowe → W kontakcie" },
    ];
    expect(countNewEntries(covered, entries)).toBe(3);
    expect(isDraftNoise({ type: "SYSTEM", body: "Szkic odpowiedzi odrzucony" })).toBe(true);
    expect(isDraftNoise({ type: "NOTE", body: "Szkic odpowiedzi — moja notatka" })).toBe(false);
  });
});

describe("powody i prośba", () => {
  it("prośba czeka, dopóki nie ma nowszej sugestii", () => {
    const req = new Date("2026-10-09T08:00:00Z");
    expect(isRequestPending(req, new Date("2026-10-09T07:30:00Z"))).toBe(true);
    expect(isRequestPending(req, new Date("2026-10-09T08:30:00Z"))).toBe(false);
    expect(isRequestPending(null, new Date())).toBe(false);
  });
  it("powody: brak / prośba / nowe wpisy", () => {
    expect(suggestionReasons({ exists: false, requestPending: false, newEntries: 0 })).toEqual(["brak sugestii"]);
    expect(suggestionReasons({ exists: true, requestPending: true, newEntries: 2 })).toEqual(["prośba o aktualizację", "nowe wpisy (2)"]);
    expect(suggestionReasons({ exists: true, requestPending: false, newEntries: 0 })).toEqual([]);
  });
});

describe("rankWork — kolejność przebiegu", () => {
  const mk = (id: string, x: Partial<{ stepDue: boolean; requestPending: boolean; stepAt: number | null; lastEntryAt: number }>) => ({ id, stepDue: false, requestPending: false, stepAt: null, lastEntryAt: 0, ...x });
  it("krok na dziś/po terminie (najstarszy pierwszy) → prośby → nowe wpisy (najnowsza aktywność pierwsza)", () => {
    const out = rankWork([
      mk("nowe-stare", { lastEntryAt: 1 }),
      mk("prosba", { requestPending: true, lastEntryAt: 5 }),
      mk("krok-pozny", { stepDue: true, stepAt: 200 }),
      mk("nowe-swieze", { lastEntryAt: 9 }),
      mk("krok-wczesny", { stepDue: true, stepAt: 100 }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["krok-wczesny", "krok-pozny", "prosba", "nowe-swieze", "nowe-stare"]);
  });
});
