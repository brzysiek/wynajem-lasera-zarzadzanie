import { describe, expect, it } from "vitest";
import { parseWwwForm, isInquiryForm } from "./www-form";
import { DEFAULT_INQUIRY_MAIL, DEFAULT_RESERVATION_MAIL, inquirySummary, messageLine, renderAutoMail } from "./auto-mail-render";
import { EMAIL_ONLY_FIRST_NOTE, callQueue, emailOnlyFirstStep, reservationFirstStep, type FunnelLead } from "./funnel";
import { isAutoWwwMail } from "./mail-rules";

// Treść wiadomości z formularza CF7 6252 „Zapytanie o wynajem — v1” (sygnał testowy 24.11).
const MSG = "Formularz: zapytanie o wynajem (v1)\nKonfiguracja: Alma Harmony XL Pro\nMiejscowość: Rzeszów\nKiedy mniej więcej: w tym miesiącu";
const body = (over: Record<string, unknown> = {}) => ({ text: "rezerwacja-wynajmu", "contact-name": "anna", "contact-email": "Anna@Example.com", "contact-message": MSG, ...over });

describe("formularz „Zapytaj o wynajem” (wniosek 62)", () => {
  it("rozpoznaje po pierwszej linii wiadomości albo po _wpcf7 = 6252; stare formularze nie", () => {
    expect(isInquiryForm(body())).toBe(true);
    expect(isInquiryForm({ "contact-message": "  formularz: Zapytanie o wynajem (v2)\nx" })).toBe(true);
    expect(isInquiryForm({ _wpcf7: "6252", "contact-message": "cokolwiek" })).toBe(true);
    expect(isInquiryForm({ _wpcf7: 6252 })).toBe(true);
    expect(isInquiryForm({ _wpcf7: "5878", "contact-message": "Chcę zarezerwować" })).toBe(false);
    expect(isInquiryForm({ "contact-message": "Mam pytanie: Formularz: zapytanie o wynajem" })).toBe(false);
    expect(isInquiryForm({})).toBe(false);
  });
  it("typ zostaje rezerwacja-wynajmu (pomiar i konwersja), urządzenie i miejscowość z wiadomości", () => {
    const f = parseWwwForm(body());
    expect(f).toMatchObject({ type: "REZERWACJA_WWW", inquiry: true, city: "Rzeszów", email: "anna@example.com", phone: null });
    expect(f.devicesText).toBe("Alma Harmony XL Pro");
    expect(f.devices).toContain("ALMA_HARMONY");
    expect(parseWwwForm({ text: "rezerwacja-wynajmu", "contact-device": "LightSheer Desire" }).inquiry).toBe(false);
  });
  it("pole contact-device ma pierwszeństwo przed linią Konfiguracja", () => {
    expect(parseWwwForm(body({ "contact-device": "LightSheer Desire" })).devicesText).toBe("LightSheer Desire");
  });
});

describe("mail po zapytaniu", () => {
  it("treść mówi o zapytaniu, nie o rezerwacji (poza zaprzeczeniem „to nie jest rezerwacja”)", () => {
    const m = renderAutoMail(DEFAULT_INQUIRY_MAIL, { name: "anna", summary: inquirySummary(parseWwwForm(body())), footer: null });
    expect(m.subject).toBe("Otrzymaliśmy Twoje zapytanie — WynajemLasera.pl");
    expect(m.text).toContain("Dzień dobry Anna,");
    expect(m.text).toContain("Urządzenie: Alma Harmony XL Pro");
    expect(m.text).toContain("Miejscowość gabinetu: Rzeszów");
    expect(m.text).toContain("Kiedy mniej więcej: w tym miesiącu");
    expect(m.text).toContain("To nie jest rezerwacja");
    expect(m.text.replace("To nie jest rezerwacja", "")).not.toMatch(/rezerwac/i);
    expect(m.text).not.toContain("Formularz:"); // nagłówek wiadomości nie trafia do maila
    expect(DEFAULT_RESERVATION_MAIL.subject).toContain("rezerwację"); // stary mail bez zmian
  });
  it("podsumowanie pomija puste pola", () => {
    expect(inquirySummary({ devicesText: null, city: null, message: "Formularz: zapytanie o wynajem (v1)" })).toEqual([]);
    expect(messageLine("a: 1\nKiedy mniej więcej: jutro", "Kiedy mniej więcej")).toBe("jutro");
    expect(messageLine(null, "x")).toBeNull();
  });
  it("temat mail jest rozpoznawany jako automat (nie kontakt biura)", () => {
    expect(isAutoWwwMail("Otrzymaliśmy Twoje zapytanie — WynajemLasera.pl")).toBe(true);
    expect(isAutoWwwMail("Otrzymaliśmy Twoje zapytanie - wynajemlasera.pl")).toBe(true);
    expect(isAutoWwwMail("Re: Otrzymaliśmy Twoje zapytanie — WynajemLasera.pl")).toBe(false);
  });
});

describe("pierwszy krok bez telefonu", () => {
  const now = new Date(2026, 10, 25, 10, 0);
  const base = reservationFirstStep(now, { requestedFrom: null, hasCity: true });
  it("zostaje PIERWSZY_KONTAKT w tym samym terminie, z notatką o mailu", () => {
    const s = emailOnlyFirstStep(base);
    expect(s).toMatchObject({ nextStepType: "PIERWSZY_KONTAKT", nextActionAt: base.nextActionAt, nextStepNote: EMAIL_ONLY_FIRST_NOTE });
    expect(s.nextStepNote).toContain("odpisz mailem z ceną i terminami");
  });
  it("pilny termin zostaje oznaczony PILNE", () => {
    const urgent = reservationFirstStep(now, { requestedFrom: "2026-11-26", hasCity: true });
    expect(emailOnlyFirstStep(urgent).nextStepNote).toBe(`PILNE — termin jutro: ${EMAIL_ONLY_FIRST_NOTE}`);
  });
  it("„Do obdzwonienia”: zapytanie bez telefonu nie trafia na listę, z telefonem — tak", () => {
    const lead = (id: string, phone: string | null): FunnelLead => ({
      id, stage: "SYGNAL", type: "REZERWACJA_WWW", createdAt: new Date(2026, 10, 25, 9), firstContactAt: null, lastContactAt: null, stageChangedAt: new Date(2026, 10, 25, 9),
      nextActionAt: new Date(2026, 10, 25, 13), nextStepType: "PIERWSZY_KONTAKT", attempts: 0, ownerId: null, rentalId: null, phone,
    });
    expect(callQueue([lead("mail", null), lead("tel", "+48600100200")], now).map((l) => l.id)).toEqual(["tel"]);
  });
});
