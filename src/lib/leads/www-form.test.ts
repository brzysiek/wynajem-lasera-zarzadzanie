import { describe, expect, it } from "vitest";
import { parseDate, parseDays, parseWebhookBody, parseWwwForm, tokenMatches, contentKey, extractExternalId } from "./www-form";

describe("parseWebhookBody", () => {
  it("JSON i formularz (checkbox jako tablica)", () => {
    expect(parseWebhookBody("application/json", '{"text":" cennik","contact-email":"A@B.PL"}')).toEqual({ text: " cennik", "contact-email": "A@B.PL" });
    const f = parseWebhookBody("application/x-www-form-urlencoded", "text=kontakt&contact-device%5B%5D=Observ+520x&contact-device%5B%5D=Alma+Harmony+XL");
    expect(f["contact-device"]).toEqual(["Observ 520x", "Alma Harmony XL"]);
    expect(parseWebhookBody(null, "")).toEqual({});
  });
});

describe("parseWwwForm", () => {
  it("rezerwacja wynajmu z kompletem pól", () => {
    const p = parseWwwForm({
      text: " rezerwacja-wynajmu",
      "contact-name": "Anna Test",
      "contact-phone": "600 100 200",
      "contact-email": "Anna@Example.PL",
      "contact-company-name": "Gabinet X",
      "contact-message": "Proszę o termin",
      "contact-device": ["LightSheer Quattro", "Kriolipoliza Cooltech"],
      "contact-date-from": "2026-10-20",
      "contact-days": "2 dni",
      utm_source: "google",
      gclid: "abc",
      "acceptance-rodo": "1",
    });
    expect(p.type).toBe("REZERWACJA_WWW");
    expect(p.email).toBe("anna@example.pl");
    expect(p.devices).toEqual(["LIGHTSHEER", "COOLTECH"]);
    expect(p.requestedFrom).toBe("2026-10-20");
    expect(p.requestedDays).toBe(2);
    expect(p.message).toContain("Firma: Gabinet X");
    expect(p.attribution).toMatchObject({ utm_source: "google", gclid: "abc", "acceptance-rodo": "1", form: "rezerwacja-wynajmu" });
  });
  it("puste daty i dni nie wywracają zapisu; urządzenie jako tekst", () => {
    const p = parseWwwForm({ text: "cennik", "contact-email": "x@y.pl", "contact-device": "Observ 520x", "contact-date-from": "", "contact-days": "" });
    expect(p.type).toBe("POBRANIE_CENNIKA");
    expect(p.requestedFrom).toBeNull();
    expect(p.requestedDays).toBeNull();
    expect(p.devices).toEqual(["OBSERV"]);
  });
  it("szkolenie, nieznany typ, test", () => {
    const s = parseWwwForm({ text: "rezerwacja-szkolenia", "contact-email": "test+www-szkolenie@wynajemlasera.pl", "contact-course-date": "05.10", "contact-device": "Alma Harmony XL" });
    expect(s.type).toBe("SZKOLENIE_WWW");
    expect(s.message).toContain("Termin szkolenia: 05.10");
    expect(s.test).toBe(true);
    const x = parseWwwForm({ text: "newsletter" });
    expect(x.type).toBe("INNE");
    expect(x.message).toContain("Formularz: newsletter");
  });
});

describe("parseDays / parseDate", () => {
  it("dni", () => {
    expect(parseDays("1 dzień")).toBe(1);
    expect(parseDays("3 dni")).toBe(3);
    expect(parseDays("tydzień (Observ)")).toBe(7);
    expect(parseDays("2 tygodnie (Observ)")).toBe(14);
    expect(parseDays("5 dni")).toBeNull();
    expect(parseDays(undefined)).toBeNull();
  });
  it("daty", () => {
    expect(parseDate("2026-10-20")).toBe("2026-10-20");
    expect(parseDate("2026-02-31")).toBeNull();
    expect(parseDate("20.10.2026")).toBe("2026-10-20");
    expect(parseDate("bzdura")).toBeNull();
  });
});

describe("tokenMatches", () => {
  it("stałoczasowo, bez tokenu w env — odmowa", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abd", "abc")).toBe(false);
    expect(tokenMatches("abc", undefined)).toBe(false);
    expect(tokenMatches(null, "abc")).toBe(false);
  });
});

describe("miejscowość (wniosek 39)", () => {
  it("z pola miejscowosc; linia w wiadomości nie jest dublowana", () => {
    const f = parseWwwForm({ text: "rezerwacja-wynajmu", "contact-email": "a@b.pl", miejscowosc: "Kraków", "contact-message": "Proszę o kontakt" });
    expect(f.city).toBe("Kraków");
    expect(f.message).toBe("Proszę o kontakt\nMiejscowość: Kraków");
    const v2 = parseWwwForm({ text: "rezerwacja-wynajmu", "contact-email": "a@b.pl", miejscowosc: "Kraków", "contact-message": "Miejscowość: Kraków\nProszę o kontakt" });
    expect(v2.message?.match(/Miejscowo/g)).toHaveLength(1);
  });
  it("bez pola — miejscowość z linii w wiadomości", () => {
    const f = parseWwwForm({ text: "rezerwacja-wynajmu", "contact-email": "a@b.pl", "contact-message": "Miejscowość: Gdańsk\nreszta" });
    expect(f.city).toBe("Gdańsk");
    expect(f.message).toBe("Miejscowość: Gdańsk\nreszta");
  });
});

describe("contentKey — duplikat to identyczna treść", () => {
  const base = { devices: ["LIGHTSHEER_DESIRE"], from: "2026-11-02", days: 2, message: "Proszę o kontakt\nMiejscowość: Kraków" };
  it("to samo zgłoszenie → ten sam klucz (kolejność urządzeń, wielkość liter i spacje bez znaczenia)", () => {
    expect(contentKey({ ...base, devices: ["ALMA", "LIGHTSHEER_DESIRE"] })).toBe(contentKey({ ...base, devices: ["LIGHTSHEER_DESIRE", "ALMA"] }));
    expect(contentKey(base)).toBe(contentKey({ ...base, message: "proszę o  kontakt\nmiejscowość: kraków " }));
  });
  it("inny termin, dni, sprzęt albo wiadomość → inny klucz", () => {
    expect(contentKey(base)).not.toBe(contentKey({ ...base, from: "2026-11-09" }));
    expect(contentKey(base)).not.toBe(contentKey({ ...base, days: 3 }));
    expect(contentKey(base)).not.toBe(contentKey({ ...base, devices: ["LIGHTSHEER_DESIRE", "ALMA"] }));
    expect(contentKey(base)).not.toBe(contentKey({ ...base, message: "Inna treść" }));
    expect(contentKey({ devices: [], from: null, days: null, message: null })).not.toBe(contentKey(base));
  });
});

describe("extractExternalId (klucz idempotencji)", () => {
  it("przyjmuje sensowny identyfikator", () => {
    expect(extractExternalId({ zgloszenie_id: "wp-4711" })).toBe("wp-4711");
    expect(extractExternalId({ zgloszenie_id: 4711 })).toBe("4711");
    expect(extractExternalId({ zgloszenie_id: ["flamingo:123"] })).toBe("flamingo:123");
  });
  it("brak, puste albo śmieci → null (zgłoszenie obsłużone normalnie)", () => {
    expect(extractExternalId({})).toBeNull();
    expect(extractExternalId({ zgloszenie_id: "" })).toBeNull();
    expect(extractExternalId({ zgloszenie_id: "ab" })).toBeNull();
    expect(extractExternalId({ zgloszenie_id: "<script>x</script>" })).toBeNull();
  });
});
