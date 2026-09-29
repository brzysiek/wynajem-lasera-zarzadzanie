import { describe, expect, it } from "vitest";
import { decideRentalClient, isGenericTitleKey, plausibleCandidate, seriesIndex, type RentalClassification } from "./rental-match-rules";

const base: RentalClassification = { kind: "WYNAJEM", titleKey: "", clientId: null, matchMethod: null, matchState: "UNMATCHED", candidates: [] };
const series = seriesIndex([
  { key: "sha twardowsksa", clientId: "koscielniak" },
  { key: "sha twardowsksa", clientId: "koscielniak" },
  { key: "anna", clientId: "a1" },
  { key: "anna", clientId: "a2" },
]);

describe("przypisanie klienta do rezerwacji (wniosek 13)", () => {
  it("alias z dopasowań → automatycznie („MIWINI” 04.12)", () => {
    const d = decideRentalClient({ classification: { ...base, titleKey: "miwini", clientId: "miwini", matchState: "CONFIRMED", matchMethod: "MANUAL" }, hubspotContact: null, series });
    expect(d).toEqual({ type: "assign", clientId: "miwini", contactId: null, method: "ALIAS" });
  });

  it("seria: ten sam tytuł przypisany wcześniej („SHA - p. Twardowsksa”)", () => {
    const d = decideRentalClient({ classification: { ...base, titleKey: "sha twardowsksa", matchState: "SUGGESTED", candidates: [{ clientId: "x", score: 0.7 }] }, hubspotContact: null, series });
    expect(d).toMatchObject({ type: "assign", clientId: "koscielniak", method: "SERIES" });
  });

  it("ten sam tytuł u dwóch klientów to nie seria", () => {
    expect(series.has("anna")).toBe(false);
  });

  it("wniosek 23: klient zapisany w wydarzeniu wygrywa; HubSpot tylko kandydatem", () => {
    expect(decideRentalClient({ classification: base, eventClientId: "z-wydarzenia", hubspotContact: { clientId: "c", contactId: "p" }, series })).toEqual({ type: "assign", clientId: "z-wydarzenia", contactId: null, method: "EVENT" });
    expect(decideRentalClient({ classification: base, hubspotContact: { clientId: "c", contactId: "p" }, series })).toEqual({ type: "pending", candidates: [{ clientId: "c", score: 1, reason: "HubSpot" }] });
  });

  it("seria Google (wydarzenie cykliczne) → automatycznie", () => {
    expect(decideRentalClient({ classification: { ...base, titleKey: "aneta rdzawka" }, recurringClientId: "az", hubspotContact: null, series })).toMatchObject({ type: "assign", clientId: "az", method: "SERIES" });
  });

  it("telefon z opisu → automatycznie; sama nazwa → do potwierdzenia z uzasadnieniem", () => {
    expect(decideRentalClient({ classification: { ...base, titleKey: "x", clientId: "c", matchState: "AUTO", matchMethod: "PHONE" }, hubspotContact: null, series })).toMatchObject({ type: "assign", method: "SIGNAL" });
    const byName = decideRentalClient({ classification: { ...base, titleKey: "nowa pani", clientId: "nowakowska", matchState: "AUTO", matchMethod: "NAME_AUTO", candidates: [{ clientId: "nowakowska", score: 0.83 }] }, hubspotContact: null, series });
    expect(byName).toEqual({ type: "pending", candidates: [{ clientId: "nowakowska", score: 0.83, reason: "podobna nazwa 0,83 – sprawdź" }] });
  });

  it("ogólny tytuł nie jest aliasem ani serią", () => {
    expect(isGenericTitleKey("nowa pani")).toBe(true);
    expect(isGenericTitleKey("klientka")).toBe(true);
    expect(isGenericTitleKey("aneta rdzawka")).toBe(false);
    expect(seriesIndex([{ key: "nowa pani", clientId: "a" }]).size).toBe(0);
    expect(decideRentalClient({ classification: { ...base, titleKey: "nowa pani", clientId: "a", matchState: "CONFIRMED" }, hubspotContact: null, series })).toMatchObject({ type: "pending" });
  });

  it("serwis / blokada / tytuł pominięty przez biuro — nie jest rezerwacją bez klienta", () => {
    expect(decideRentalClient({ classification: { ...base, kind: "INNE" }, hubspotContact: null, series })).toEqual({ type: "skip" });
    expect(decideRentalClient({ classification: { ...base, matchState: "IGNORED" }, hubspotContact: null, series })).toEqual({ type: "skip" });
  });
});

describe("sensowność propozycji (wniosek 13)", () => {
  const von = { nameTokens: ["katarzyna", "von"], persons: [{ first: ["katarzyna"], last: ["von"] }], aliasTokens: [], cityTokens: ["warszawa"] };
  const grylewicz = { nameTokens: ["studio", "urody"], persons: [{ first: ["malgorzata"], last: ["grylewicz"] }], aliasTokens: [], cityTokens: [] };
  it("inne imię i nazwisko → bez podpowiedzi", () => {
    expect(plausibleCandidate(["aleksandra", "kucewicz", "wa"], von)).toBe(false);
  });
  it("literówka w nazwisku tylko razem z imieniem (także zdrobnieniem)", () => {
    expect(plausibleCandidate(["gralewicz", "malgosia"], grylewicz)).toBe(true);
    expect(plausibleCandidate(["gralewicz", "anna"], grylewicz)).toBe(false);
    expect(plausibleCandidate(["grylewicz"], grylewicz)).toBe(true);
  });
  it("samo imię w nazwie firmy nie wystarczy", () => {
    expect(plausibleCandidate(["anna", "kowal"], { nameTokens: ["anna", "nowak", "gabinet"], persons: [{ first: ["anna"], last: ["nowak"] }], aliasTokens: [], cityTokens: [] })).toBe(false);
  });
  it("alias albo nazwa firmy wystarczy", () => {
    expect(plausibleCandidate(["miwini"], { nameTokens: ["studio", "urody", "miwini"], persons: [], aliasTokens: [], cityTokens: [] })).toBe(true);
    expect(plausibleCandidate(["sha", "twardowsksa"], { nameTokens: ["dominika"], persons: [], aliasTokens: [["sha", "twardowsksa"]], cityTokens: [] })).toBe(true);
  });
});
