import { describe, expect, it } from "vitest";
import { leadTitle, noteHtmlToText, parseDealDescription, parseDealName, planLeadFromDeal, shouldImportDeal } from "./parse-deal";

// Prawdziwe kształty danych z HubSpota (26.09.2026), zanonimizowane.
describe("parseDealName", () => {
  it("formularze WWW", () => {
    expect(parseDealName("WWW - pobranie cennika - Kosmetologia.X@gmail.com")).toEqual({
      type: "POBRANIE_CENNIKA",
      email: "kosmetologia.x@gmail.com",
      fromForm: true,
    });
    expect(parseDealName("WWW - kontakt - m.x88@gmail.com").type).toBe("KONTAKT");
    expect(parseDealName("WWW - rezerwacja wynajmu - kontakt@gabinet.pl").type).toBe("REZERWACJA_WWW");
    expect(parseDealName("WWW - szkolenie - a@b.pl").type).toBe("SZKOLENIE_WWW");
  });

  it("ręczne transakcje = telefon, e-mail wyciągany z nazwy", () => {
    expect(parseDealName("Bloomhouse Wiktoria Pisarek Lightsheer i Observ")).toEqual({ type: "TELEFON", email: null, fromForm: false });
    expect(parseDealName("Barbara Karpierz atelier.kosmetologia@gmail.com")).toMatchObject({
      type: "TELEFON",
      email: "atelier.kosmetologia@gmail.com",
    });
  });
});

describe("parseDealDescription", () => {
  it("rezerwacja wynajmu — wszystkie pola, przecinki w wiadomości", () => {
    const d = parseDealDescription(
      "REZERWACJA_WWW",
      "Imię i nazwisko: Aleksandra K, Urządzenia: Observ 520x, Wynajem od: 2026-10-01, Dni: 1 dzień, Wiadomość: Jesteśmy zainteresowane, na 1-3 dni w miesiącu, od października. Czy mogę prosić o wycenę?, telefon: 725025450",
    );
    expect(d).toEqual({
      personName: "Aleksandra K",
      devicesText: "Observ 520x",
      devices: ["OBSERV"],
      requestedFrom: "2026-10-01",
      requestedDays: 1,
      message: "Jesteśmy zainteresowane, na 1-3 dni w miesiącu, od października. Czy mogę prosić o wycenę?",
      phone: "725025450",
    });
  });

  it("rezerwacja z kilkoma urządzeniami, pusta wiadomość, telefon z +48", () => {
    const d = parseDealDescription(
      "REZERWACJA_WWW",
      "Imię i nazwisko: Kateryna R , Urządzenia: LightSheer Desire,LightSheer Desire Light,LightSheer Quattro, Wynajem od: 2026-04-10, Dni: 3 dni, Wiadomość: , telefon: +48 731 478 486",
    );
    expect(d.personName).toBe("Kateryna R");
    expect(d.devices).toEqual(["LIGHTSHEER"]);
    expect(d.requestedDays).toBe(3);
    expect(d.message).toBeNull();
    expect(d.phone).toBe("+48 731 478 486");
  });

  it("wiadomość wieloliniowa", () => {
    const d = parseDealDescription(
      "REZERWACJA_WWW",
      "Imię i nazwisko: Magdalena S, Urządzenia: Kriolipoliza Cooltech, Wynajem od: 2026-04-01, Dni: 1 dzień, Wiadomość: Witam,\r\nMyślę o wynajmie\r\nPozdrawiam, telefon: 797455290",
    );
    expect(d.devices).toEqual(["COOLTECH"]);
    expect(d.message).toBe("Witam,\nMyślę o wynajmie\nPozdrawiam");
  });

  it("formularz kontaktowy „treść - Imię”", () => {
    const d = parseDealDescription("KONTAKT", "Dzień dobry, w jakiej cenie szkolenie z platformy Alma Harmony xl pro ? - Dorota ");
    expect(d.personName).toBe("Dorota");
    expect(d.message).toBe("Dzień dobry, w jakiej cenie szkolenie z platformy Alma Harmony xl pro ?");
    expect(d.devices).toEqual(["ALMA_HARMONY"]);
  });

  it("pusty opis", () => {
    expect(parseDealDescription("POBRANIE_CENNIKA", null).message).toBeNull();
  });
});

describe("noteHtmlToText", () => {
  it("HTML notatki HubSpot → tekst", () => {
    expect(noteHtmlToText('<div dir="auto"><p style="margin:0;">Wysłano ofertę &amp; cennik.</p><p>Oddzwonić</p></div>')).toBe(
      "Wysłano ofertę & cennik.\nOddzwonić",
    );
  });
});


const phone = (raw: string) => {
  const d = raw.replace(/[^\d]/g, "").replace(/^48(?=\d{9}$)/, "");
  return /^\d{9}$/.test(d) ? `+48${d}` : null;
};

describe("shouldImportDeal", () => {
  it("od 09.2025 wszystkie, starsze tylko poza Sygnałem, tylko lejek default", () => {
    expect(shouldImportDeal({ pipeline: "default", createdate: "2026-01-01T10:00:00Z", dealstage: "3115771105" })).toBe(true);
    expect(shouldImportDeal({ pipeline: "default", createdate: "2025-05-01T10:00:00Z", dealstage: "3115771105" })).toBe(false);
    expect(shouldImportDeal({ pipeline: "default", createdate: "2025-05-01T10:00:00Z", dealstage: "closedwon" })).toBe(true);
    expect(shouldImportDeal({ pipeline: "2247404753", createdate: "2026-06-29T10:00:00Z", dealstage: "3080529125" })).toBe(false);
  });
});

describe("planLeadFromDeal", () => {
  it("rezerwacja WWW", () => {
    const l = planLeadFromDeal(
      {
        dealname: "WWW - rezerwacja wynajmu - kontakt@gabinet.pl",
        dealstage: "3115771105",
        createdate: "2026-08-19T08:49:55.876Z",
        description: "Imię i nazwisko: Aleksandra K, Urządzenia: Observ 520x, Wynajem od: 2026-10-01, Dni: 2 dni, Wiadomość: , telefon: 725 025 450",
        telefon_z_szansy: null,
      },
      phone,
    );
    expect(l).toMatchObject({
      type: "REZERWACJA_WWW",
      stage: "SYGNAL",
      title: "Aleksandra K — Observ 2 dni",
      email: "kontakt@gabinet.pl",
      phone: "+48725025450",
      requestedDays: 2,
      fromForm: true,
    });
    expect(l.requestedFrom?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("pobranie cennika — telefon z „Telefon z sygnału”, zamrażalnik = przegrana", () => {
    const l = planLeadFromDeal(
      { dealname: "WWW - pobranie cennika - x@wp.pl", dealstage: "3211592907", createdate: "2026-09-23T08:34:31Z", telefon_z_szansy: "451255300" },
      phone,
    );
    expect(l).toMatchObject({ type: "POBRANIE_CENNIKA", stage: "PRZEGRANA", lostReason: "INNE", lostNote: "Zamrażalnik w HubSpot", phone: "+48451255300", title: "x@wp.pl" });
  });

  it("ręczna transakcja zostaje przy nazwie Ani", () => {
    const l = planLeadFromDeal({ dealname: "Bloome Beauty Space", dealstage: "closedwon", createdate: "2026-08-17T06:37:23Z", telefon_z_szansy: "+48530400047" }, phone);
    expect(l).toMatchObject({ type: "TELEFON", stage: "WYGRANA", title: "Bloome Beauty Space", phone: "+48530400047" });
  });

  it("tytuł", () => {
    expect(leadTitle({ who: null, devices: [], days: null, fallback: "a@b.pl" })).toBe("a@b.pl");
    expect(leadTitle({ who: "Gabinet X", devices: ["LIGHTSHEER"], days: 1, fallback: "" })).toBe("Gabinet X — LightSheer 1 dzień");
  });
});
