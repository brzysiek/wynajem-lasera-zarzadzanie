import { describe, expect, it } from "vitest";
import { addWorkHours, buildNaDzis, callQueue, maxStageReached, medianFirstContactHours, naDzisKpis, nextWorkdayAt10, planOutcome, type FunnelLead } from "./funnel";

// Wrzesień/październik 2026: 25.09 = piątek, 28.09 = poniedziałek, 02.10 = piątek.
const at = (day: number, h = 12, m = 0, month = 9) => new Date(2026, month - 1, day, h, m);
const state = { stage: "SYGNAL" as const, nextStepType: "PIERWSZY_KONTAKT", attempts: 0, followUpNo: 0 };

describe("wynik kontaktu → następny krok", () => {
  it("Wysłałam ofertę w piątek → follow-up w środę 10:00, etap Oferta", () => {
    const p = planOutcome({ ...state, stage: "WYWIAD" }, "offer_sent", at(2, 11, 0, 10));
    expect(p.stage).toBe("OFERTA");
    expect(p.nextActionAt).toEqual(at(7, 10, 0, 10));
    expect(p).toMatchObject({ nextStepType: "FOLLOW_UP_OFERTY", followUpNo: 1, contact: true });
  });

  it("follow-up 1 bez odpowiedzi → 2. follow-up +7 dni rob.", () => {
    const p = planOutcome({ stage: "OFERTA", nextStepType: "FOLLOW_UP_OFERTY", attempts: 0, followUpNo: 1 }, "no_answer", at(7, 10, 0, 10));
    expect(p.nextActionAt).toEqual(at(16, 10, 0, 10));
    expect(p).toMatchObject({ followUpNo: 2, attempts: 0, noAnswerLimit: false });
  });

  it("Nie odebrała → jutro 10:00 (z piątku na poniedziałek); 3. próba = limit", () => {
    const p1 = planOutcome(state, "no_answer", at(25, 15));
    expect(p1.nextActionAt).toEqual(at(28, 10));
    expect(p1).toMatchObject({ attempts: 1, nextStepType: "PONOWNA_PROBA", noAnswerLimit: false, contact: false });
    const p3 = planOutcome({ ...state, attempts: 2 }, "no_answer", at(28, 11));
    expect(p3).toMatchObject({ attempts: 3, noAnswerLimit: true });
  });

  it("Rozmawiam → co najmniej Wywiad, zeruje próby; Oferta zostaje", () => {
    expect(planOutcome({ ...state, attempts: 2 }, "talked", at(28))).toMatchObject({ stage: "WYWIAD", attempts: 0, contact: true });
    expect(planOutcome({ ...state, stage: "OFERTA" }, "talked", at(28)).stage).toBeNull();
    expect(planOutcome(state, "callback", at(28), { at: at(30, 9) })).toMatchObject({ nextActionAt: at(30, 9), nextStepType: "ODDZWONI" });
  });
});

describe("czas pracy", () => {
  it("SLA 4 h rob.: z piątku 15:00 na poniedziałek 10:00; w nocy od 8:00", () => {
    expect(addWorkHours(at(25, 15), 4)).toEqual(at(28, 10));
    expect(addWorkHours(at(28, 6), 4)).toEqual(at(28, 12));
    expect(nextWorkdayAt10(at(27, 20))).toEqual(at(28, 10));
  });

  it("mediana z czekającymi: sygnał bez kontaktu liczy się do teraz", () => {
    const now = at(30, 17);
    expect(medianFirstContactHours([{ createdAt: at(28, 8), firstContactAt: at(28, 9) }, { createdAt: at(28, 8), firstContactAt: null }, { createdAt: at(28, 8), firstContactAt: null }], now)).toBe(27);
  });
});

const lead = (p: Partial<FunnelLead> & { id: string }): FunnelLead => ({
  stage: "SYGNAL",
  type: "POBRANIE_CENNIKA",
  createdAt: at(20),
  firstContactAt: null,
  lastContactAt: null,
  stageChangedAt: at(20),
  nextActionAt: null,
  nextStepType: null,
  attempts: 0,
  ownerId: "ania",
  rentalId: null,
  phone: "+48600000000",
  ...p,
});

describe("Na dziś i Do obdzwonienia", () => {
  const now = at(28, 12);
  const leads = [
    lead({ id: "stary", createdAt: new Date(2025, 10, 5), nextActionAt: at(28, 9), firstContactAt: new Date(2025, 10, 6), nextStepType: "PONOWNA_PROBA" }),
    lead({ id: "zalegly", firstContactAt: at(21), nextActionAt: at(24, 10), nextStepType: "FOLLOW_UP_OFERTY", stage: "OFERTA" }),
    lead({ id: "dzis", firstContactAt: at(21), nextActionAt: at(28, 15), nextStepType: "ODDZWONI", stage: "WYWIAD" }),
    lead({ id: "nowy", createdAt: at(27), nextActionAt: at(28, 12), nextStepType: "PIERWSZY_KONTAKT" }),
    lead({ id: "stycz", createdAt: new Date(2026, 0, 13), type: "REZERWACJA_WWW", nextActionAt: at(28, 8), nextStepType: "PIERWSZY_KONTAKT" }),
    lead({ id: "rez", stage: "REZERWACJA", firstContactAt: at(21) }),
    lead({ id: "wygrana", stage: "WYGRANA", rentalId: "r1" }),
  ];

  it("Na dziś bez sygnałów sprzed 2026; nowe tylko z 30 dni; rezerwacje bez wynajmu", () => {
    const d = buildNaDzis(leads, now);
    expect(d.due.map((l) => l.id)).toEqual(["zalegly", "dzis"]);
    expect(d.fresh.map((l) => l.id)).toEqual(["nowy"]);
    expect(d.toLink.map((l) => l.id)).toEqual(["rez"]);
  });

  it("kolejka: zaległe → rezerwacje WWW → cennik; bez rezerwacji i sprzed 2026", () => {
    // „dzis” (oddzwoni dziś 15:00) — też w kolejce, w grupie cennika po nowszym „nowy”.
    expect(callQueue(leads, now).map((l) => l.id)).toEqual(["zalegly", "stycz", "nowy", "dzis"]);
  });

  it("wskaźniki Na dziś", () => {
    const k = naDzisKpis(leads, now);
    expect(k.overdue).toBe(1); // zalegly (nowy ma krok dziś 12:00 = teraz, jeszcze nie po terminie)
    expect(k.today).toBe(2);
  });
});

describe("najwyższy osiągnięty etap", () => {
  const labels = { SYGNAL: "Sygnał", WYWIAD: "Wywiad", OFERTA: "Oferta wysłana", REZERWACJA: "Rezerwacja", WYGRANA: "Wygrana", PRZEGRANA: "Przegrana" };
  it("przegrana po ofercie liczy się jako oferta; wynajem = co najmniej rezerwacja", () => {
    expect(maxStageReached("PRZEGRANA", ["Sygnał → Wywiad", "Wywiad → Oferta wysłana", "Oferta wysłana → Przegrana · powód: Cena"], labels, false)).toBe("OFERTA");
    expect(maxStageReached("SYGNAL", [], labels, false)).toBe("SYGNAL");
    expect(maxStageReached("WYWIAD", [], labels, true)).toBe("REZERWACJA");
    expect(maxStageReached("WYGRANA", [], labels, true)).toBe("WYGRANA");
  });
});
