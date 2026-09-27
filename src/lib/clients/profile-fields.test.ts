import { describe, expect, it } from "vitest";
import { dropNullJson, isLocked, parseClientProfilePatch, parseContactProfilePatch, parseDay, parsePkd, stampFieldMeta, validRegon } from "./profile-fields";
import { parseClientPatch } from "./validate";

describe("nowe pola klienta", () => {
  it("MiWiNi: REGON, data rozpoczęcia, PKD", () => {
    const r = parseClientPatch({ regon: "526905596", businessStartDate: "02.12.2023", pkd: "96.02.Z zabiegi kosmetyczne; 85.59.B; 47.75.Z", legalForm: "JDG" });
    expect(r).toEqual({
      ok: true,
      data: {
        regon: "526905596",
        legalForm: "JDG",
        businessStartDate: new Date(Date.UTC(2023, 11, 2, 12)),
        pkd: [
          { code: "96.02.Z", name: "zabiegi kosmetyczne", main: true },
          { code: "85.59.B", name: null, main: false },
          { code: "47.75.Z", name: null, main: false },
        ],
      },
    });
  });
  it("REGON z sumą kontrolną", () => {
    expect(validRegon("526905596")).toBe(true);
    expect(validRegon("526905597")).toBe(false);
    expect(parseClientProfilePatch({ regon: "123" }).ok).toBe(false);
  });
  it("paszport dostawy, linki, zgody, następny krok", () => {
    const r = parseClientProfilePatch({
      deliveryNotes: { wejscie: "od podwórza", pietro: "parter", parking: "", zasilanie: "230 V, bezpiecznik 16 A" },
      links: { instagram: "@miwini.studiourody", fresha: "https://fresha.com/x" },
      marketingConsent: { email: "tak", sms: false, date: "2026-09-27", source: "rozmowa" },
      smsReminders: true,
      googleReview: { askedAt: "22.09.2025", given: null },
      nextStepText: "Zaproponować 27.11 i 18.12",
      nextStepDueAt: "2026-10-02",
      services: "depilacja, brwi, depilacja",
      agreedPrice: "1 180",
    });
    expect(r).toMatchObject({
      ok: true,
      data: {
        deliveryNotes: { entrance: "od podwórza", floor: "parter", parking: null, power: "230 V, bezpiecznik 16 A", receiver: null },
        links: { instagram: "@miwini.studiourody", fresha: "https://fresha.com/x", www: null },
        marketingConsent: { email: true, sms: false, date: "2026-09-27", source: "rozmowa" },
        smsReminders: true,
        googleReview: { askedAt: "2025-09-22", given: null },
        services: ["depilacja", "brwi"],
        agreedPrice: "1180.00",
      },
    });
  });
  it("błędy i czyszczenie", () => {
    expect(parseClientProfilePatch({ invoiceEmail: "zly" }).ok).toBe(false);
    expect(parseClientProfilePatch({ frameAgreement: { url: "http://x" } }).ok).toBe(false);
    expect(parseClientProfilePatch({ nextStepDueAt: "31.02.2026" }).ok).toBe(false);
    expect(parseClientProfilePatch({ pkd: "abc" }).ok).toBe(false);
    expect(parseClientProfilePatch({ deliveryNotes: { parking: " " }, links: null })).toEqual({ ok: true, data: { deliveryNotes: null, links: null } });
  });
  it("daty i PKD", () => {
    expect(parseDay("2023-12-02")).toEqual(new Date(Date.UTC(2023, 11, 2, 12)));
    expect(parseDay("")).toBeNull();
    expect(parsePkd([{ kod: "9602Z", nazwa: "Fryzjerstwo i zabiegi", glowny: true }])).toEqual([{ code: "96.02.Z", name: "Fryzjerstwo i zabiegi", main: true }]);
  });
});

describe("nowe pola osoby", () => {
  it("role (także po polsku), kanał, zwrot, szkolenia", () => {
    expect(
      parseContactProfilePatch({ roles: ["właścicielka", "decides", "faktury"], preferredChannel: "SMS i telefon", salutation: "Pani Basiu", trainedOn: [{ device: "LightSheer Desire", date: "2024-01-05" }, "LightSheer Quattro"] }),
    ).toEqual({
      ok: true,
      data: {
        roles: ["owner", "decides", "invoices"],
        preferredChannel: "SMS i telefon",
        salutation: "Pani Basiu",
        trainedOn: [
          { device: "LightSheer Desire", date: "2024-01-05" },
          { device: "LightSheer Quattro", date: null },
        ],
      },
    });
    expect(parseContactProfilePatch({ roles: ["szef"] }).ok).toBe(false);
  });
});

describe("pochodzenie pól", () => {
  it("zmiana ręczna blokuje pole, uzupełnianie po NIP nie zdejmuje blokady", () => {
    const at = new Date("2026-09-27T10:00:00Z");
    const m1 = stampFieldMeta({}, ["regon"], { source: "panel", by: "u1", at, lock: true });
    expect(m1.regon).toEqual({ source: "panel", sourceRef: null, verifiedAt: at.toISOString(), verifiedBy: "u1", lockedManual: true });
    const m2 = stampFieldMeta(m1, ["regon", "vatStatus"], { source: "bialalista", by: null, at, lock: false });
    expect(isLocked(m2, "regon")).toBe(true);
    expect(isLocked(m2, "vatStatus")).toBe(false);
  });
  it("null w polach JSON przy tworzeniu = brak pola", () => {
    expect(dropNullJson({ firstName: "Ala", roles: null })).toEqual({ firstName: "Ala" });
  });
});
