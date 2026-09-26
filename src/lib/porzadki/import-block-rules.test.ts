import { describe, expect, it } from "vitest";
import { dealsToImport, withoutBlocked } from "./import-block-rules";

describe("blokada ponownego importu", () => {
  it("transakcja usunięta w panelu nie wraca; nowa transakcja tej samej osoby — tak", () => {
    const deals = [
      { id: "d1", email: "anna@x.pl" }, // już w panelu
      { id: "d2", email: "anna@x.pl" }, // usunięta trwale → zablokowana
      { id: "d3", email: "anna@x.pl" }, // nowy formularz tej samej osoby
    ];
    expect(dealsToImport(deals, new Set(["d1"]), new Set(["d2"])).map((d) => d.id)).toEqual(["d3"]);
  });

  it("klienci: zablokowana firma i kontakty odpadają, reszta zostaje", () => {
    const plan = [
      { key: "company:1", hubspotCompanyId: "1", contacts: [{ hubspotContactId: "a" }] },
      { key: "company:2", hubspotCompanyId: "2", contacts: [{ hubspotContactId: "b" }, { hubspotContactId: "c" }] },
      { key: "contact:d", hubspotCompanyId: null, contacts: [{ hubspotContactId: "d" }] },
      { key: "company:3", hubspotCompanyId: "3", contacts: [] },
    ];
    const out = withoutBlocked(plan, new Set(["b", "d"]), new Set(["1"]));
    expect(out.map((c) => c.key)).toEqual(["company:2", "company:3"]);
    expect(out[0].contacts.map((p) => p.hubspotContactId)).toEqual(["c"]);
  });
});
