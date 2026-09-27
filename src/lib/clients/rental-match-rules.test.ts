import { describe, expect, it } from "vitest";
import { decideRentalClient, seriesIndex, type RentalClassification } from "./rental-match-rules";

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

  it("kontakt HubSpot wygrywa", () => {
    const d = decideRentalClient({ classification: base, hubspotContact: { clientId: "c", contactId: "p" }, series });
    expect(d).toEqual({ type: "assign", clientId: "c", contactId: "p", method: "HUBSPOT" });
  });

  it("telefon z opisu → automatycznie; sama nazwa → do potwierdzenia", () => {
    expect(decideRentalClient({ classification: { ...base, titleKey: "x", clientId: "c", matchState: "AUTO", matchMethod: "PHONE" }, hubspotContact: null, series })).toMatchObject({ type: "assign", method: "SIGNAL" });
    const byName = decideRentalClient({ classification: { ...base, titleKey: "katrzyna orzel mszana", clientId: "orzel", matchState: "AUTO", matchMethod: "NAME_AUTO", candidates: [{ clientId: "orzel", score: 0.95 }] }, hubspotContact: null, series });
    expect(byName).toEqual({ type: "pending", candidates: [{ clientId: "orzel", score: 0.95 }] });
  });

  it("serwis / blokada / tytuł pominięty przez biuro — nie jest rezerwacją bez klienta", () => {
    expect(decideRentalClient({ classification: { ...base, kind: "INNE" }, hubspotContact: null, series })).toEqual({ type: "skip" });
    expect(decideRentalClient({ classification: { ...base, matchState: "IGNORED" }, hubspotContact: null, series })).toEqual({ type: "skip" });
  });
});
