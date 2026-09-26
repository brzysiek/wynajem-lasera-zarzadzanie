import { describe, expect, it } from "vitest";
import { normalizeClass, parseProposalItem } from "./proposal-rules";

const prov = { zrodlo: "Biała lista", pewnosc: "wysoka", paczka: "P-1" };

describe("parseProposalItem", () => {
  it("pole klienta", () => {
    const r = parseProposalItem({ rodzaj: "pole", klient_id: "c1", pole: "city", proponowane: "Kraków", klasa: "Miasto — słownik", ...prov });
    expect(r).toEqual({
      ok: true,
      value: { kind: "FIELD", clientId: "c1", contactId: null, leadId: null, field: "city", proposed: "Kraków", provenance: { source: "Biała lista", confidence: "HIGH", batch: "P-1" }, changeClass: "miasto_slownik" },
    });
  });
  it("pola poza zakresem agenta odrzucone", () => {
    expect(parseProposalItem({ rodzaj: "pole", klient_id: "c1", pole: "transportPriceNet", proponowane: "150", ...prov }).ok).toBe(false);
    expect(parseProposalItem({ rodzaj: "osoba", klient_id: "c1", osoba_id: "p1", pole: "isPrimary", proponowane: true, ...prov }).ok).toBe(false);
  });
  it("osoba wymaga osoba_id; wartość null dozwolona", () => {
    expect(parseProposalItem({ rodzaj: "osoba", klient_id: "c1", pole: "phone", proponowane: "601000111", ...prov }).ok).toBe(false);
    expect(parseProposalItem({ rodzaj: "osoba", klient_id: "c1", osoba_id: "p1", pole: "phone2", proponowane: null, ...prov })).toMatchObject({ ok: true, value: { proposed: null } });
  });
  it("źródło, pewność i paczka wymagane", () => {
    expect(parseProposalItem({ rodzaj: "pole", klient_id: "c1", pole: "city", proponowane: "X", zrodlo: "a", pewnosc: "wysoka" }).ok).toBe(false);
    expect(parseProposalItem({ rodzaj: "pole", klient_id: "c1", pole: "city", proponowane: "X", pewnosc: "wysoka", paczka: "P" }).ok).toBe(false);
  });
  it("archiwizacja klienta albo sygnału, z powodem i dopiskiem", () => {
    expect(parseProposalItem({ rodzaj: "archiwizacja", klient_id: "c1", powod: "SPAM", dopisek: "reklama", ...prov })).toMatchObject({
      ok: true,
      value: { kind: "ARCHIVE", clientId: "c1", proposed: { reason: "SPAM", note: "reklama" } },
    });
    expect(parseProposalItem({ rodzaj: "archiwizacja", sygnal_id: "l1", powod: "TEST", dopisek: "test", ...prov })).toMatchObject({ ok: true, value: { leadId: "l1" } });
    expect(parseProposalItem({ rodzaj: "archiwizacja", klient_id: "c1", powod: "SPAM", ...prov }).ok).toBe(false);
    expect(parseProposalItem({ rodzaj: "archiwizacja", klient_id: "c1", sygnal_id: "l1", powod: "SPAM", dopisek: "x", ...prov }).ok).toBe(false);
  });
  it("scalenie", () => {
    expect(parseProposalItem({ rodzaj: "scalenie", klient_id: "c1", duplikat_id: "c2", ...prov })).toMatchObject({ ok: true, value: { kind: "MERGE", proposed: { duplicateId: "c2" } } });
    expect(parseProposalItem({ rodzaj: "scalenie", klient_id: "c1", duplikat_id: "c1", ...prov }).ok).toBe(false);
  });
  it("wydzielenie", () => {
    expect(parseProposalItem({ rodzaj: "wydzielenie", klient_id: "c1", osoby_ids: ["k1"], nazwa: "MiWiNi", faktury_nip: "9441828201", ...prov })).toMatchObject({
      ok: true,
      value: { kind: "SPLIT", clientId: "c1", proposed: { contactIds: ["k1"], name: "MiWiNi", invoiceNip: "9441828201", nip: "9441828201" } },
    });
    expect(parseProposalItem({ rodzaj: "wydzielenie", klient_id: "c1", nazwa: "X", ...prov }).ok).toBe(false);
  });
  it("nieznany rodzaj", () => {
    expect(parseProposalItem({ rodzaj: "usuniecie", klient_id: "c1", ...prov }).ok).toBe(false);
  });
});

describe("normalizeClass", () => {
  it("klucz klasy", () => {
    expect(normalizeClass("Ujednolicenie nazwy miasta ze słownika")).toBe("ujednolicenie_nazwy_miasta_ze_slownika");
    expect(normalizeClass("  ")).toBeNull();
  });
});
