import { describe, expect, it } from "vitest";
import { planInbound, planOutbound, type ChatLead } from "./chat-plan";

const lead = (over: Partial<ChatLead> = {}): ChatLead => ({ stage: "SYGNAL", firstContactAt: null, lastContactAt: null, nextActionAt: null, ...over });
const T = new Date(2026, 9, 28, 12); // środa 28.10.2026 12:00

describe("planOutbound", () => {
  it("nasza odpowiedź na nowy sygnał → W kontakcie, pierwszy kontakt, krok za 2 dni rob. 10:00", () => {
    const p = planOutbound(lead(), T, "MESSENGER")!;
    expect(p).toMatchObject({ stage: "WYWIAD", firstContactAt: T, lastContactAt: T, nextStepType: "INNE" });
    expect(p.nextActionAt).toEqual(new Date(2026, 9, 30, 10));
    expect(p.activity).toContain("Messengerze");
  });
  it("sygnał już po kontakcie: tylko ostatni kontakt, bez zmiany etapu i kroku", () => {
    const p = planOutbound(lead({ stage: "WYWIAD", firstContactAt: new Date(2026, 9, 1), lastContactAt: new Date(2026, 9, 5) }), T, "INSTAGRAM")!;
    expect(p).toMatchObject({ lastContactAt: T, activity: "" });
    expect(p.stage).toBeUndefined();
    expect(p.nextActionAt).toBeUndefined();
    expect(p.firstContactAt).toBeUndefined();
  });
  it("starsze echo nie cofa ostatniego kontaktu", () => {
    const later = new Date(2026, 9, 29);
    expect(planOutbound(lead({ stage: "OFERTA", firstContactAt: later, lastContactAt: later }), T, "MESSENGER")).toBeNull();
  });
});

describe("planInbound", () => {
  it("nowy, nietknięty sygnał: bez zmian (czas na kontakt już liczy SLA)", () => {
    expect(planInbound(lead(), T, "MESSENGER")).toBeNull();
  });
  it("odłożony sygnał: wraca do W kontakcie z krokiem na teraz", () => {
    expect(planInbound(lead({ stage: "ODLOZONE" }), T, "MESSENGER")).toMatchObject({ stage: "WYWIAD", clearReturn: true, nextActionAt: T, nextStepType: "DOPYTAC" });
  });
  it("W kontakcie / Oferta bez kroku albo z krokiem w przyszłości: krok na teraz", () => {
    expect(planInbound(lead({ stage: "WYWIAD" }), T, "INSTAGRAM")).toMatchObject({ nextActionAt: T });
    expect(planInbound(lead({ stage: "OFERTA", nextActionAt: new Date(2026, 10, 9) }), T, "MESSENGER")).toMatchObject({ nextActionAt: T });
  });
  it("krok już na dziś lub zaległy, Rezerwacja: bez zmian (brak powtórnych wpisów)", () => {
    expect(planInbound(lead({ stage: "WYWIAD", nextActionAt: T }), T, "MESSENGER")).toBeNull();
    expect(planInbound(lead({ stage: "WYWIAD", nextActionAt: new Date(2026, 9, 20) }), T, "MESSENGER")).toBeNull();
    expect(planInbound(lead({ stage: "REZERWACJA" }), T, "MESSENGER")).toBeNull();
  });
});
