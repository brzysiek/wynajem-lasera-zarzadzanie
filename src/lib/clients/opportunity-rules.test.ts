import { describe, expect, it } from "vitest";
import { parseOpportunityInput } from "./opportunity-rules";
import { cardQuality } from "./card-quality";

describe("szanse sprzedaży", () => {
  it("polskie klucze agenta", () => {
    expect(parseOpportunityInput({ urzadzenie: "Cooltech – modelowanie ciała", etap: "oferta", szansa: "średnia", ostatni_kontakt: "2025-03-28", wrocic: "2027-02-01", opis: "bez decyzji" })).toEqual({
      ok: true,
      value: {
        device: "Cooltech – modelowanie ciała",
        stage: "oferta",
        chance: "srednia",
        lastContact: new Date(Date.UTC(2025, 2, 28, 12)),
        returnAt: new Date(Date.UTC(2027, 1, 1, 12)),
        note: "bez decyzji",
      },
    });
  });
  it("walidacja i zmiana częściowa", () => {
    expect(parseOpportunityInput({ etap: "oferta" }).ok).toBe(false);
    expect(parseOpportunityInput({ urzadzenie: "X", etap: "kupione" }).ok).toBe(false);
    expect(parseOpportunityInput({ stage: "wygrana" }, { partial: true })).toEqual({ ok: true, value: { stage: "wygrana" } });
  });
});

describe("jakość danych", () => {
  const base = {
    status: "STALY",
    name: "MiWiNi",
    nip: "9441828201",
    street: "Rudawska 4",
    city: "Rudawa",
    clinicType: "SALON_BEAUTY",
    hubspotCompanyId: null,
    aliasesCount: 9,
    invoicesCount: 4,
    rentalsTotal: 29,
    paymentsAsOf: null,
    contacts: [{ phone: "+48791777897", email: "a@b.pl", roles: ["owner"], trainedOn: [], isPrimary: true }],
    profile: {
      regon: "526905596",
      legalForm: "JDG",
      businessStartDate: "2023-12-02",
      pkd: [{}],
      vatStatus: null,
      deliveryAddress: null,
      deliveryNotes: null,
      services: ["depilacja"],
      openingHours: "pn–pt 9–20",
      ownDevices: null,
      invoiceEmail: "a@b.pl",
      paymentTerms: null,
      marketingConsent: null,
      smsReminders: true,
    },
    fieldSources: ["ceidg", "CEIDG · HubSpot · Fresha", "panel"],
  };
  it("procent, braki i źródła bez powtórzeń", () => {
    const q = cardQuality(base);
    expect(q.missing).toEqual(["status VAT", "dojazd i zasilanie", "własne urządzenia gabinetu", "data szkolenia", "warunki płatności", "zgoda marketingowa", "wpłaty (wyciąg z banku)"]);
    expect(q.percent).toBe(68);
    expect(q.sources).toEqual(["CEIDG", "HubSpot", "Fresha", "panel", "Fakturownia", "kalendarze urządzeń"]);
  });
  it("potencjalny klient — tylko podstawy", () => {
    expect(cardQuality({ ...base, status: "POTENCJALNY" }).percent).toBe(100);
  });
});
