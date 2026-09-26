import { describe, expect, it } from "vitest";
import { ARCHIVE_NOTE, applyImportRules, callListProgress, isCallListPending, sortCallList } from "./call-list";
import { isQualified } from "../clients/qualification";

const plan = { stage: "SYGNAL" as const, lostReason: null, lostNote: null };
const d = (iso: string) => new Date(iso);
const until = new Date("2026-09-27T10:00:00Z"); // wdrożenie listy

describe("applyImportRules", () => {
  it("nieobsłużone z 2026 → Do obdzwonienia (także z Zamrażalnika)", () => {
    expect(applyImportRules(plan, { hsStage: "3115771105", createdAt: d("2026-03-01T10:00:00Z"), handled: false, callListUntil: until })).toMatchObject({ stage: "SYGNAL", callList: true });
    expect(
      applyImportRules({ stage: "PRZEGRANA", lostReason: "INNE", lostNote: "Zamrażalnik w HubSpot" }, { hsStage: "3211592907", createdAt: d("2026-02-01T10:00:00Z"), handled: false, callListUntil: until }),
    ).toMatchObject({ stage: "SYGNAL", callList: true, lostReason: null });
  });

  it("nieobsłużone sprzed 2026 → przegrana, archiwum", () => {
    expect(applyImportRules(plan, { hsStage: "3115771105", createdAt: d("2025-10-10T10:00:00Z"), handled: false, callListUntil: until })).toMatchObject({
      stage: "PRZEGRANA",
      lostReason: "ARCHIWUM_IMPORTU",
      lostNote: ARCHIVE_NOTE,
      callList: false,
    });
  });

  it("obsłużone albo w dalszym etapie — bez zmian", () => {
    expect(applyImportRules(plan, { hsStage: "3115771105", createdAt: d("2026-03-01T10:00:00Z"), handled: true, callListUntil: until })).toMatchObject({ stage: "SYGNAL", callList: false });
    expect(applyImportRules({ stage: "OFERTA", lostReason: null, lostNote: null }, { hsStage: "qualifiedtobuy", createdAt: d("2026-03-01T10:00:00Z"), handled: false, callListUntil: until })).toMatchObject({
      stage: "OFERTA",
      callList: false,
    });
  });

  it("sygnały po wdrożeniu nigdy nie trafiają na listę", () => {
    expect(applyImportRules(plan, { hsStage: "3115771105", createdAt: d("2026-09-28T10:00:00Z"), handled: false, callListUntil: until })).toMatchObject({
      stage: "SYGNAL",
      callList: false,
    });
  });

  it("1 stycznia 2026 o północy w Warszawie już się łapie", () => {
    expect(applyImportRules(plan, { hsStage: "3115771105", createdAt: d("2025-12-31T23:30:00Z"), handled: false, callListUntil: until }).callList).toBe(true);
  });
});

describe("lista do obdzwonienia", () => {
  it("kolejność: rezerwacje, kontakt, cennik; w grupie od najnowszych", () => {
    const rows = [
      { id: "c1", type: "POBRANIE_CENNIKA" as const, createdAt: "2026-05-01" },
      { id: "k1", type: "KONTAKT" as const, createdAt: "2026-02-01" },
      { id: "r1", type: "REZERWACJA_WWW" as const, createdAt: "2026-01-10" },
      { id: "r2", type: "REZERWACJA_WWW" as const, createdAt: "2026-04-10" },
    ];
    expect(sortCallList(rows).map((r) => r.id)).toEqual(["r2", "r1", "k1", "c1"]);
  });

  it("postęp: rozmowa albo zmiana etapu zdejmuje z listy, nieodebrane nie", () => {
    const rows = [
      { callList: true, stage: "SYGNAL" as const, talked: false, clientQualified: false },
      { callList: true, stage: "SYGNAL" as const, talked: true, clientQualified: true },
      { callList: true, stage: "PRZEGRANA" as const, talked: false, clientQualified: false },
      { callList: false, stage: "SYGNAL" as const, talked: false, clientQualified: false },
    ];
    expect(callListProgress(rows)).toEqual({ total: 3, done: 2, pending: 1, qualified: 1 });
    expect(isCallListPending(rows[0])).toBe(true);
  });
});

describe("isQualified", () => {
  it("wynajem / historia / faktura kwalifikują zawsze; przed włączeniem — wszyscy", () => {
    expect(isQualified({ qualifiedAt: null, rentals: 0, history: 0, invoices: 0 }, true)).toBe(false);
    expect(isQualified({ qualifiedAt: null, rentals: 0, history: 2, invoices: 0 }, true)).toBe(true);
    expect(isQualified({ qualifiedAt: new Date(), rentals: 0, history: 0, invoices: 0 }, true)).toBe(true);
    expect(isQualified({ qualifiedAt: null, rentals: 0, history: 0, invoices: 0 }, false)).toBe(true);
  });
});
