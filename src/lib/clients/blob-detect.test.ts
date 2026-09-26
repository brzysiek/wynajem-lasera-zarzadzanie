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
  it("faktury na dwa NIP-y wystarczą", () => {
    expect(blobScore({ name: "X", nip: null, hubspotCompanyId: null, contacts: [p("A", "a@x.pl")], invoiceNips: ["111", "222"] }).score).toBeGreaterThanOrEqual(SUSPECT_SCORE);
  });
});
