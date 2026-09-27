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
    expect(parseProposalItem({ rodzaj: "pole", klient_id: "c1", pole: "distanceKm", proponowane: "15", ...prov }).ok).toBe(false);
    // Warunki handlowe (cena, transport, forma płatności) — tylko propozycja do akceptacji.
    expect(parseProposalItem({ rodzaj: "pole", klient_id: "c1", pole: "transportPriceNet", proponowane: "180", ...prov }).ok).toBe(true);
    expect(parseProposalItem({ rodzaj: "pole", klient_id: "c1", pole: "paymentForm", proponowane: "oba", ...prov }).ok).toBe(true);
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
  it("dopasowanie płatności: przelew → faktura", () => {
    expect(parseProposalItem({ rodzaj: "dopasowanie_platnosci", przelew_id: "t1", faktura_id: "412345", ...prov })).toMatchObject({
      ok: true,
      value: { kind: "PAYMENT_MATCH", clientId: null, proposed: { transferId: "t1", fakturowniaInvoiceId: 412345 } },
    });
    expect(parseProposalItem({ rodzaj: "dopasowanie_platnosci", faktura_id: 1, ...prov }).ok).toBe(false);
    expect(parseProposalItem({ rodzaj: "dopasowanie_platnosci", przelew_id: "t1", faktura_id: "FV 1", ...prov }).ok).toBe(false);
  });
  it("wykluczenie: lista domen z pliku agenta", () => {
    expect(parseProposalItem({ rodzaj: "wykluczenie", wartosci: ["edina.pl", "https://www.tylia.pl", "wach.kuba@gmail.com"], typ: "wyklucz", dopisek: "wniosek 7", ...prov })).toMatchObject({
      ok: true,
      value: { kind: "EXCLUSION", proposed: { values: ["edina.pl", "tylia.pl", "wach.kuba@gmail.com"], kind: "EXCLUDE", note: "wniosek 7" } },
    });
    expect(parseProposalItem({ rodzaj: "wykluczenie", wartosci: "kreatywnainzynieria.pl", typ: "ukrywaj", ...prov })).toMatchObject({ ok: true, value: { proposed: { kind: "HIDE" } } });
    expect(parseProposalItem({ rodzaj: "wykluczenie", wartosci: [], ...prov }).ok).toBe(false);
  });
  it("nieznany rodzaj", () => {
    expect(parseProposalItem({ rodzaj: "usuniecie", klient_id: "c1", ...prov }).ok).toBe(false);
  });
});

describe("cennik_klienta i adres_dostawy (etap D)", () => {
  it("cena klienta: urządzenie × dni", () => {
    const r = parseProposalItem({ rodzaj: "cennik_klienta", klient_id: "c1", urzadzenie: "LS_1G", dni: 1, cena: "850", zrodlo_ceny: "oferta", odnosnik: "oferta 30.10.2025", ...prov });
    expect(r.ok && r.value).toMatchObject({ kind: "CLIENT_PRICE", field: "LS_1G|1", proposed: { device: "LS_1G", days: 1, priceNet: 850, source: "OFERTA", sourceRef: "oferta 30.10.2025" } });
    expect(parseProposalItem({ rodzaj: "cennik_klienta", klient_id: "c1", urzadzenie: "LS_1G", dni: 1, usun: true, ...prov })).toMatchObject({ ok: true, value: { proposed: { priceNet: null } } });
    expect(parseProposalItem({ rodzaj: "cennik_klienta", klient_id: "c1", urzadzenie: "LASER", dni: 1, cena: 850, ...prov }).ok).toBe(false);
    expect(parseProposalItem({ rodzaj: "cennik_klienta", klient_id: "c1", urzadzenie: "LS_1G", dni: 0, cena: 850, ...prov }).ok).toBe(false);
  });
  it("adres dostawy: polskie klucze, nowy wymaga miejscowości", () => {
    const r = parseProposalItem({ rodzaj: "adres_dostawy", klient_id: "c1", nazwa: "Wieliczka", ulica: "Asnyka 5", miejscowosc: "Wieliczka", wejscie: "od podwórza", domyslny: true, ...prov });
    expect(r.ok && r.value).toMatchObject({ kind: "DELIVERY_ADDRESS", field: "nowy", proposed: { addressId: null, label: "Wieliczka", street: "Asnyka 5", city: "Wieliczka", entrance: "od podwórza", isDefault: true } });
    expect(parseProposalItem({ rodzaj: "adres_dostawy", klient_id: "c1", nazwa: "X", ...prov }).ok).toBe(false);
    const upd = parseProposalItem({ rodzaj: "adres_dostawy", klient_id: "c1", adres_id: "a1", parking: "za budynkiem", ...prov });
    expect(upd.ok && upd.value.field).toBe("a1");
  });
});

describe("normalizeClass", () => {
  it("klucz klasy", () => {
    expect(normalizeClass("Ujednolicenie nazwy miasta ze słownika")).toBe("ujednolicenie_nazwy_miasta_ze_slownika");
    expect(normalizeClass("  ")).toBeNull();
  });
});

describe("propozycje lejka (etap L4)", () => {
  const prov = { zrodlo: "notatki", pewnosc: "wysoka", paczka: "P-L4" };
  it("sygnal_nowy z maila", () => {
    const r = parseProposalItem({ rodzaj: "sygnal_nowy", email: "Ola@Example.com", urzadzenie: "lightsheer", odnosnik: "gmail:abc", notatka: "pyta o termin", ...prov });
    expect(r.ok && r.value).toMatchObject({ kind: "SIGNAL_NEW", field: "gmail:abc", proposed: { type: "EMAIL", contactEmail: "ola@example.com", deviceInterest: ["LIGHTSHEER"] } });
    expect(parseProposalItem({ rodzaj: "sygnal_nowy", ...prov }).ok).toBe(false);
  });
  it("powod_przegranej po etykiecie, INNE z notatką", () => {
    const r = parseProposalItem({ rodzaj: "powod_przegranej", sygnal_id: "l1", powod: "za daleko", ...prov });
    expect(r.ok && r.value.proposed).toEqual({ lostReason: "ODLEGLOSC", lostNote: null });
    expect(parseProposalItem({ rodzaj: "powod_przegranej", sygnal_id: "l1", powod: "INNE", ...prov }).ok).toBe(false);
  });
  it("krok_sygnalu i powiazanie_wynajmu", () => {
    expect(parseProposalItem({ rodzaj: "krok_sygnalu", sygnal_id: "l1", termin: "2026-10-05", rodzaj_kroku: "oddzwoni", ...prov })).toMatchObject({ ok: true, value: { leadId: "l1", proposed: { at: "2026-10-05", stepType: "ODDZWONI" } } });
    expect(parseProposalItem({ rodzaj: "powiazanie_wynajmu", sygnal_id: "l1", wynajem_id: "r1", ...prov })).toMatchObject({ ok: true, value: { kind: "RENTAL_LINK", proposed: { rentalId: "r1" } } });
  });
});
