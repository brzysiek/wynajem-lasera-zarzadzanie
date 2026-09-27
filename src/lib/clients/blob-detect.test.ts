import { describe, expect, it } from "vitest";
import { SUSPECT_SCORE, blobScore } from "./blob-detect";

const p = (firstName: string, email: string | null, lastName: string | null = null) => ({ firstName, lastName, email });

describe("wykrywanie zlepków", () => {
  it("„Joanna Bakalarz” — typowy zlepek", () => {
    const r = blobScore({
      name: "Joanna Bakalarz",
      nip: "6621249644",
      hubspotCompanyId: "229351323845",
      contacts: [
        p("Joanna", "joannabakalarz74@gmail.com", "Bakalarz"),
        p("Natalia", "brak10@brak.pl"),
        p("Emilia", "emilia.nigbor@interia.pl", "Nigbor"),
        p("Alicja", "brak1@brak.pl"),
        p("Barbara", "miwini.studiourody@gmail.com", "Trzaska"),
        p("Iryna", "brak4@brak.pl"),
        p("Weronika", "brak16@brak.pl"),
        p("Elżbieta", "brak2@brak.pl"),
      ],
      invoiceNips: ["9441828201", "9441828201"],
    });
    expect(r.score).toBeGreaterThanOrEqual(SUSPECT_SCORE);
    expect(r.reasons.join(" | ")).toContain("5 osób z adresem zastępczym");
    expect(r.reasons.join(" | ")).toContain("NIP klienta 6621249644 nie występuje");
  });
  it("zwykły gabinet z dwiema osobami — nie", () => {
    const r = blobScore({ name: "Salon Ewa", nip: "1234567890", hubspotCompanyId: "300", contacts: [p("Ewa", "ewa@salon.pl"), p("Ola", "ola@salon.pl")], invoiceNips: ["1234567890"] });
    expect(r.score).toBeLessThan(SUSPECT_SCORE);
    expect(r.reasons).toEqual([]);
  });
  it("„Anna Górska” — zlepek na darmowej domenie, kraj USA, NIP bez faktur (wniosek 3)", () => {
    const r = blobScore({
      name: "Anna Górska",
      nip: "7341070956",
      hubspotCompanyId: "229407504592",
      country: "United States",
      invoicesCount: 0,
      contacts: [
        { firstName: "Anna", lastName: "Górska", email: "anna.gorska@interia.eu", phone: "+48600100200" },
        { firstName: "Monika", lastName: "Nowak", email: "m.nowak@interia.eu", phone: "+48600100201" },
        { firstName: "Ewa", lastName: "Wiśniewska", email: "ewa.w@interia.eu", phone: null },
        { firstName: "Kasia", lastName: "Zając", email: null, phone: "+48600100203" },
      ],
      invoiceNips: [],
    });
    expect(r.score).toBeGreaterThanOrEqual(SUSPECT_SCORE);
    expect(r.reasons.join(" | ")).toContain("darmową domenę (interia.eu)");
    expect(r.reasons.join(" | ")).toContain("kraj „United States”");
  });
  it("rodzina (Kowalska / Kowalski) w jednym gabinecie — nie", () => {
    const r = blobScore({
      name: "Salon Kowalskich",
      nip: "1234567890",
      hubspotCompanyId: "301",
      country: "Polska",
      invoicesCount: 3,
      contacts: [
        { firstName: "Anna", lastName: "Kowalska", email: "anna@gmail.com", phone: "+48600000001" },
        { firstName: "Jan", lastName: "Kowalski", email: "jan@gmail.com", phone: "+48600000002" },
        { firstName: "Ola", lastName: "Kowalska", email: null, phone: null },
      ],
      invoiceNips: ["1234567890"],
    });
    expect(r.score).toBeLessThan(SUSPECT_SCORE);
  });
  it("faktury na dwa NIP-y wystarczą", () => {
    expect(blobScore({ name: "X", nip: null, hubspotCompanyId: null, contacts: [p("A", "a@x.pl")], invoiceNips: ["111", "222"] }).score).toBeGreaterThanOrEqual(SUSPECT_SCORE);
  });
  it("dwie osoby z różnymi nazwiskami łączy tylko gmail — zlepek (wniosek 3)", () => {
    const r = blobScore({
      name: "Salon X",
      nip: null,
      hubspotCompanyId: "501",
      country: "Polska",
      contacts: [
        { firstName: "Anna", lastName: "Górska", email: "anna.gorska@gmail.com", phone: "+48600100200" },
        { firstName: "Monika", lastName: "Nowak", email: "monika.n@gmail.com", phone: "+48600100201" },
      ],
      invoiceNips: [],
    });
    expect(r.score).toBeGreaterThanOrEqual(SUSPECT_SCORE);
    expect(r.reasons.join(" | ")).toContain("wyłącznie przez darmową domenę (gmail.com)");
  });
  it("firma HubSpot nazwana domeną brak.pl — zlepek", () => {
    const r = blobScore({
      name: "brak.pl",
      nip: null,
      hubspotCompanyId: "502",
      contacts: [
        { firstName: "Anna", lastName: null, email: "anna@wp.pl" },
        { firstName: "Ola", lastName: null, email: "ola@o2.pl" },
      ],
      invoiceNips: [],
    });
    expect(r.score).toBeGreaterThanOrEqual(SUSPECT_SCORE);
    expect(r.reasons.join(" | ")).toContain("nazwana domeną „brak.pl”");
  });
  it("wspólna domena firmowa obok gmaila — nie tylko darmowa domena", () => {
    const r = blobScore({
      name: "Gabinet Y",
      nip: null,
      hubspotCompanyId: "503",
      contacts: [
        { firstName: "Anna", lastName: "Górska", email: "anna@gmail.com" },
        { firstName: "Ewa", lastName: "Nowak", email: "ewa@gmail.com" },
        { firstName: "Iza", lastName: "Lis", email: "iza@gabinety.pl" },
      ],
      invoiceNips: [],
    });
    expect(r.reasons.join(" | ")).not.toContain("wyłącznie");
  });
});
