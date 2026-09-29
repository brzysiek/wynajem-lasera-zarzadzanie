import { describe, expect, it } from "vitest";
import { STAGE_HISTORY_LABELS } from "./labels";
import { stageForStep, addWorkHours, buildInbox, buildToday, buildNaDzis, callQueue, inboxKpis, maxStageReached, medianFirstContactHours, naDzisKpis, nextWorkdayAt10, planOutcome, rotInfo, type FunnelLead } from "./funnel";

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

  it("Nie odebrała → jutro 16:00, potem 8:30 (z piątku na poniedziałek); 3. próba = limit", () => {
    const p1 = planOutcome(state, "no_answer", at(25, 15));
    expect(p1.nextActionAt).toEqual(at(28, 16));
    expect(planOutcome({ ...state, attempts: 1 }, "no_answer", at(28, 16)).nextActionAt).toEqual(at(29, 8, 30));
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
    lead({ id: "wygrana-luzem", stage: "WYGRANA", createdAt: at(22) }),
  ];

  it("Na dziś bez sygnałów sprzed 2026; nowe tylko z 30 dni; rezerwacje bez wynajmu", () => {
    const d = buildNaDzis(leads, now);
    expect(d.due.map((l) => l.id)).toEqual(["zalegly", "dzis"]);
    expect(d.fresh.map((l) => l.id)).toEqual(["nowy"]);
    expect(d.toLink.map((l) => l.id)).toEqual(["rez", "wygrana-luzem"]);
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
  const labels = STAGE_HISTORY_LABELS;
  it("przegrana po ofercie liczy się jako oferta; wynajem = co najmniej rezerwacja", () => {
    expect(maxStageReached("PRZEGRANA", ["Sygnał → Wywiad", "Wywiad → Oferta wysłana", "Oferta wysłana → Przegrana · powód: Cena"], labels, false)).toBe("OFERTA");
    expect(maxStageReached("SYGNAL", [], labels, false)).toBe("SYGNAL");
    // nazwy v2 i sprzed v2 w jednej historii
    expect(maxStageReached("PRZEGRANA", ["Nowe → W kontakcie"], labels, false)).toBe("WYWIAD");
    expect(maxStageReached("WYWIAD", [], labels, true)).toBe("REZERWACJA");
    expect(maxStageReached("WYGRANA", [], labels, true)).toBe("WYGRANA");
  });
});

describe("lejek v2: Odłożone, gnicie, Skrzynka", () => {
  const now = at(28, 12); // pn 28.09 12:00
  it("Odłóż do… → Odłożone z powrotem o 9:00", () => {
    const p = planOutcome({ stage: "OFERTA", nextStepType: "FOLLOW_UP_OFERTY", attempts: 0, followUpNo: 1 }, "postpone", now, { at: new Date(2026, 9, 5), note: "wraca: zbiera oferty" });
    expect(p).toMatchObject({ stage: "ODLOZONE", nextStepType: "POWROT", nextStepNote: "wraca: zbiera oferty" });
    expect(p.nextActionAt).toEqual(new Date(2026, 9, 5, 9));
    expect(maxStageReached("ODLOZONE", [], STAGE_HISTORY_LABELS, false)).toBe("WYWIAD");
  });

  it("gnicie: Nowe po SLA, W kontakcie > 3 dni rob., Oferta > 10 dni, brak kroku; aktywność zeruje", () => {
    expect(rotInfo(lead({ id: "n", createdAt: at(25, 9) }), now)).toMatchObject({ rotting: true, label: "po czasie · 1 dzień rob." });
    expect(rotInfo(lead({ id: "n2", createdAt: at(28, 9) }), now).rotting).toBe(false);
    const talked = { firstContactAt: at(21), stage: "WYWIAD" as const, stageChangedAt: at(21), nextActionAt: at(30) };
    expect(rotInfo(lead({ id: "k", ...talked }), now)).toMatchObject({ rotting: true, label: "stoi 5 dni rob." });
    expect(rotInfo(lead({ id: "k2", ...talked, lastWorkAt: at(25, 16) }), now).rotting).toBe(false);
    expect(rotInfo(lead({ id: "o", firstContactAt: at(10), stage: "OFERTA", stageChangedAt: at(15), nextActionAt: at(30) }), now)).toMatchObject({ rotting: true, label: "stoi 13 dni" });
    expect(rotInfo(lead({ id: "b", firstContactAt: at(27), stage: "WYWIAD", stageChangedAt: at(27) }), now)).toMatchObject({ rotting: true, label: "brak kroku" });
    expect(rotInfo(lead({ id: "r", firstContactAt: at(1), stage: "REZERWACJA", stageChangedAt: at(1) }), now).rotting).toBe(false);
  });

  it("Skrzynka: nowe, na dziś, gniją, wracają", () => {
    const leads = [
      lead({ id: "nowy", createdAt: at(27), nextActionAt: at(28, 12) }),
      lead({ id: "dzis", firstContactAt: at(21), stage: "WYWIAD", stageChangedAt: at(25), nextActionAt: at(28, 15) }),
      lead({ id: "gnije", firstContactAt: at(10), stage: "OFERTA", stageChangedAt: at(12), nextActionAt: at(30) }),
      lead({ id: "rez", firstContactAt: at(20), stage: "REZERWACJA", stageChangedAt: at(20) }),
      lead({ id: "odl", firstContactAt: at(20), stage: "ODLOZONE", returnAt: new Date(2026, 9, 1, 9), nextActionAt: new Date(2026, 9, 1, 9) }),
    ];
    const b = buildInbox(leads, now);
    expect(b.fresh.map((l) => l.id)).toEqual(["nowy"]);
    expect(b.today.map((l) => l.id)).toEqual(["dzis", "rez"]);
    expect(b.rotting.map((l) => l.id)).toEqual(["gnije"]);
    expect(b.returning.map((l) => l.id)).toEqual(["odl"]);
    expect(inboxKpis(leads, now)).toMatchObject({ fresh: 1, today: 2, rotting: 1, returningWeek: 1 });
  });
});

describe("Lista „Na dziś” (28.09)", () => {
  const now = at(28, 12);
  it("po czasie → nowe → dziś → wracają; grupy planu dnia", () => {
    const leads = [
      lead({ id: "stara-nowa", createdAt: at(25, 9), nextActionAt: at(25, 13) }),
      lead({ id: "nowa", createdAt: at(28, 10), nextActionAt: at(28, 14) }),
      lead({ id: "proba", createdAt: at(22), attempts: 1, nextStepType: "PONOWNA_PROBA", nextActionAt: at(28, 16) }),
      lead({ id: "followup-zalegly", firstContactAt: at(10), stage: "OFERTA", stageChangedAt: at(15), nextStepType: "FOLLOW_UP_OFERTY", nextActionAt: at(15) }),
      lead({ id: "oddzwoni", firstContactAt: at(21), stage: "WYWIAD", nextStepType: "ODDZWONI", nextActionAt: at(28, 12) }),
      lead({ id: "rez", firstContactAt: at(21), stage: "REZERWACJA" }),
      lead({ id: "odl", firstContactAt: at(1), stage: "ODLOZONE", returnAt: at(28, 9) }),
      lead({ id: "jutro", firstContactAt: at(21), stage: "WYWIAD", nextStepType: "INNE", nextActionAt: at(29) }),
    ];
    const t = buildToday(leads, now);
    expect(t.map((x) => [x.lead.id, x.priority])).toEqual([
      ["stara-nowa", "late"],
      ["followup-zalegly", "late"],
      ["nowa", "new"],
      ["proba", "new"],
      ["rez", "today"],
      ["oddzwoni", "today"],
      ["odl", "back"],
    ]);
    expect(t.find((x) => x.lead.id === "followup-zalegly")!.group).toBe("followups");
    expect(t.find((x) => x.lead.id === "oddzwoni")!.group).toBe("calls");
  });

  it("przegląd 29.09 07:15: stare nietknięte i próby jutro nie zalewają „Na dziś”", () => {
    const leads = [
      // Nietknięte z marca: termin rozłożony na jutro — nie ma go dziś.
      lead({ id: "marzec-jutro", createdAt: at(3, 10, 0, 3), nextActionAt: at(29, 9) }),
      // Nietknięte z kwietnia z terminem dziś → „umówione telefony”, nie „nowe”.
      lead({ id: "kwiecien-dzis", createdAt: at(16, 10, 0, 4), nextActionAt: at(28, 9) }),
      // Nietknięte z maja, termin minął → po czasie, w telefonach.
      lead({ id: "maj-zalegly", createdAt: at(5, 10, 0, 5), nextActionAt: at(25, 9) }),
      // Kolejna próba jutro 16:00 — nie „dziś 16:00”, choć zapytanie po czasie.
      lead({ id: "proba-jutro", createdAt: at(21), attempts: 1, nextStepType: "PONOWNA_PROBA", nextActionAt: at(29, 16) }),
    ];
    const t = buildToday(leads, now);
    expect(t.map((x) => [x.lead.id, x.priority, x.group])).toEqual([
      ["maj-zalegly", "late", "calls"],
      ["kwiecien-dzis", "today", "calls"],
    ]);
  });
});

describe("krok zgodny z etapem (kontrola 29.09 09:35, pkt 2)", () => {
  it("follow-up oferty przed „Oferta wysłana” → Oferta wysłana; inne kroki i dalsze etapy bez zmian", () => {
    expect(stageForStep("WYWIAD", "FOLLOW_UP_OFERTY")).toBe("OFERTA");
    expect(stageForStep("SYGNAL", "FOLLOW_UP_OFERTY")).toBe("OFERTA");
    expect(stageForStep("OFERTA", "FOLLOW_UP_OFERTY")).toBeNull();
    expect(stageForStep("REZERWACJA", "FOLLOW_UP_OFERTY")).toBeNull();
    expect(stageForStep("WYWIAD", "DOPYTAC")).toBeNull();
  });
});

describe("Wracają z wiosny — 3 dziennie wg rytmu (wniosek 21)", () => {
  it("z puli nieobdzwonionych bierze 3 z najbliższym terminem rytmu; zaplanowane ręcznie wg swojej daty", () => {
    const now = at(30, 12);
    const spring = (id: string, dueDay: number | null, x: Partial<FunnelLead> = {}) =>
      ({ ...lead({ id, firstContactAt: null, stage: "WYWIAD", nextStepType: "UMOW_TERMIN", nextActionAt: at(7, 9, 0, 10), ...x }), sourceRef: `wiosna:${id}`, spring: { dueAt: dueDay ? at(dueDay, 9, 0, 9).toISOString() : null } });
    const t = buildToday([spring("a", 20), spring("b", 5), spring("c", null), spring("d", 10), spring("e", 1), spring("oddzwoni", 1, { nextStepType: "ODDZWONI", nextActionAt: at(16, 9, 0, 10) })], now);
    expect(t.map((x) => [x.lead.id, x.group])).toEqual([
      ["e", "spring"],
      ["b", "spring"],
      ["d", "spring"],
    ]);
  });
});
