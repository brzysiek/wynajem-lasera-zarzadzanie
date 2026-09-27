import { describe, expect, it } from "vitest";
import { countBy, firstContactBuckets, funnelSteps, inRange, reportKpis, type ReportLead } from "./report";

const at = (day: number, h = 10, month = 9) => new Date(2026, month - 1, day, h);
const lead = (p: Partial<ReportLead>): ReportLead => ({
  type: "POBRANIE_CENNIKA",
  stage: "SYGNAL",
  maxStage: "SYGNAL",
  createdAt: at(21),
  firstContactAt: null,
  lastContactAt: null,
  stageChangedAt: at(21),
  lostReason: null,
  rentalId: null,
  ...p,
});

describe("raport lejka", () => {
  const leads = [
    lead({}),
    lead({ firstContactAt: at(21, 12), stage: "WYWIAD", maxStage: "WYWIAD" }),
    lead({ firstContactAt: at(22, 9), stage: "PRZEGRANA", maxStage: "OFERTA", lostReason: "CENA" }),
    lead({ firstContactAt: at(21, 17), stage: "REZERWACJA", maxStage: "REZERWACJA", rentalId: "r" }),
    lead({ type: "TELEFON", firstContactAt: at(28, 9), stage: "WYGRANA", maxStage: "WYGRANA", rentalId: "r2" }),
    lead({ type: "EMAIL", stage: "WYGRANA", maxStage: "WYGRANA" }), // wygrana bez wynajmu — nie liczy się
  ];

  it("lejek „kiedykolwiek osiągnął” z % do poprzedniego", () => {
    const f = funnelSteps(leads);
    expect(f.map((s) => s.count)).toEqual([6, 5, 5, 4, 3, 1]);
    expect(f[1].pctOfPrev).toBe(83);
    expect(f[5].pctOfPrev).toBe(33);
  });

  it("czas do 1. kontaktu w koszykach (pn 21.09)", () => {
    const b = Object.fromEntries(firstContactBuckets(leads).map((x) => [x.key, x.count]));
    expect(b).toEqual({ sla: 1, sameDay: 1, upTo3: 1, over3: 1, waiting: 1 });
  });

  it("źródła i zakres", () => {
    expect(inRange(leads, "2026", "phone", at(30)).length).toBe(1);
    expect(inRange(leads, "30", "www", at(30)).length).toBe(4);
    expect(countBy(leads, (l) => l.type)[0]).toEqual({ key: "POBRANIE_CENNIKA", count: 4 });
  });

  it("wskaźniki: bez kontaktu z otwartych, wygrane tylko z wynajmem", () => {
    const k = reportKpis(leads, at(30));
    expect(k).toMatchObject({ total: 6, noContact: 1, won: 1, wonPct: 17 });
  });
});
