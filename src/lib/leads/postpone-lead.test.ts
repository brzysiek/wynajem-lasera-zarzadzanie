import { beforeEach, describe, expect, it, vi } from "vitest";

// Wniosek 49: odłożenie bez rozmowy (np. z propozycji agenta) nie jest
// kontaktem — bez pierwszego / ostatniego kontaktu, wpisu CALL, „talked”,
// podniesienia maxStage i „wyniku rozmowy”; poprzednia notatka kroku zostaje,
// także po dniu powrotu; „Wynik rozmowy → Odłóż do…” działa jak dotąd.

type Row = Record<string, unknown>;
const db = { lead: null as Row | null, updates: [] as Row[], activities: [] as Row[], due: [] as Row[] };

vi.mock("@/lib/prisma", () => {
  const generic = () => new Proxy({}, { get: () => vi.fn(async () => null) });
  const prisma: Record<string, unknown> = {
    lead: {
      findUnique: vi.fn(async () => db.lead),
      findMany: vi.fn(async () => db.due),
      update: vi.fn(async ({ data }: { data: Row }) => (db.updates.push(data), {})),
    },
    leadActivity: { create: vi.fn(async ({ data }: { data: Row }) => (db.activities.push(data), {})) },
    task: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({})), create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]))),
  };
  return { prisma: new Proxy(prisma, { get: (t, k: string) => (k in t ? t[k] : generic()) }) };
});
vi.mock("@/lib/integrations/szybkisms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/clients/qualify", () => ({ qualifyClient: vi.fn(async () => undefined) }));
vi.mock("@/lib/leads/intake", () => ({ intakeRules: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/reminders", () => ({ normalizePolishPhone: (p: string) => p }));

const { postponeLead, logLeadActivity } = await import("./actions");
const { reviveReturningLeads } = await import("./rental-link");
const { maxStageReached } = await import("./funnel");
const { STAGE_HISTORY_LABELS } = await import("./labels");
const { parseProposalItem } = await import("@/lib/porzadki/proposal-rules");

const NOW = new Date(2026, 9, 11, 21, 31); // niedziela 11.10.2026 21:31
const PHONE_NOTE = "Zadzwonić z 2 wolnymi terminami Almy, zapytać o szkolenie";

function newLead(over: Row = {}): Row {
  return { id: "L1", title: "Szczytowska", stage: "SYGNAL", clientId: "C1", ownerId: "u1", firstContactAt: null, lastContactAt: null, rentalId: null, nextStepType: "INNE", nextStepNote: PHONE_NOTE, nextActionAt: new Date(2026, 9, 13, 10), attempts: 0, followUpNo: 0, ...over };
}

beforeEach(() => {
  db.lead = newLead();
  db.updates = [];
  db.activities = [];
  db.due = [];
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("postponeLead — odłożenie bez rozmowy", () => {
  const run = (note: string | null = null) => postponeLead("L1", { returnAt: new Date(2026, 9, 13), reason: "INNE", note }, "tomek", "PROPOSAL");

  it("nie ustawia kontaktu, prób ani źródła „wynik rozmowy”; etap Odłożone z datą powrotu", async () => {
    await run();
    const u = db.updates[0];
    expect(u).toMatchObject({ stage: "ODLOZONE", postponeReason: "INNE", nextStepType: "POWROT", stageSource: "PROPOSAL", stepSource: "PROPOSAL" });
    expect(u.returnAt).toEqual(new Date(2026, 9, 13, 9));
    expect(u.nextActionAt).toEqual(new Date(2026, 9, 13, 9));
    for (const k of ["firstContactAt", "lastContactAt", "attempts", "followUpNo"]) expect(u).not.toHaveProperty(k);
    expect(JSON.stringify(u)).not.toContain("OUTCOME");
  });

  it("oś czasu: STAGE_CHANGE i SYSTEM, żadnego CALL / EMAIL (więc „talked” zostaje false)", async () => {
    await run("woli popołudnie");
    expect(db.activities.map((a) => a.type)).toEqual(["STAGE_CHANGE", "SYSTEM"]);
    expect(db.activities[0].body).toBe("Nowe → Odłożone");
    expect(db.activities[1].body).toContain("Odłożone do 13.10.2026 (inny powód): woli popołudnie");
    expect(db.activities.some((a) => a.type === "CALL" || a.type === "EMAIL")).toBe(false);
  });

  it("karta: poprzednia notatka kroku zostaje w treści kroku powrotu, razem z dopiskiem", async () => {
    await run("woli popołudnie");
    expect(db.updates[0].nextStepNote).toBe(`wraca: inny powód — woli popołudnie. Wcześniej: ${PHONE_NOTE}`);
  });

  it("z karty (bez rozmowy): źródło USER z autorem, nadal bez kontaktu i bez CALL", async () => {
    await postponeLead("L1", { returnAt: new Date(2026, 9, 20), reason: "URLOP" }, "ania", "USER");
    expect(db.updates[0]).toMatchObject({ stage: "ODLOZONE", stageSource: "USER", stageSourceById: "ania", stepSource: "USER" });
    expect(db.updates[0]).not.toHaveProperty("firstContactAt");
    expect(db.activities.some((a) => a.type === "CALL")).toBe(false);
  });

  it("maxStage nie rośnie dla odłożenia z Nowe bez kontaktu; rośnie, gdy był kontakt", () => {
    const L = STAGE_HISTORY_LABELS;
    expect(maxStageReached("ODLOZONE", ["Nowe → Odłożone"], L, false, false)).toBe("SYGNAL");
    expect(maxStageReached("ODLOZONE", ["Nowe → Odłożone"], L, false, true)).toBe("WYWIAD");
    expect(maxStageReached("ODLOZONE", ["W kontakcie → Odłożone"], L, false, false)).toBe("WYWIAD");
    expect(maxStageReached("ODLOZONE", ["Nowe → W kontakcie", "W kontakcie → Odłożone"], L, false, false)).toBe("WYWIAD");
    expect(maxStageReached("ODLOZONE", [], L, false)).toBe("WYWIAD"); // stare odłożenia bez wpisu etapu
  });

  it("odmawia przeszłej daty i sygnału na etapie Odłożone / Wygrana", async () => {
    await expect(postponeLead("L1", { returnAt: new Date(2026, 9, 11), reason: "INNE" }, "tomek")).rejects.toThrow(/od jutra/);
    db.lead = newLead({ stage: "ODLOZONE" });
    await expect(run()).rejects.toThrow(/Nowe, W kontakcie albo Oferta/);
  });

  it("po dniu powrotu notatka poprzedniego kroku wraca na kartę", async () => {
    await run("woli popołudnie");
    const postponed = db.updates[0];
    db.due = [{ id: "L1", clientId: "C1", returnAt: postponed.returnAt, postponeReason: "INNE", nextStepNote: postponed.nextStepNote }];
    db.updates = [];
    await reviveReturningLeads(new Date(2026, 9, 13, 10));
    const u = db.updates[0];
    // z klientką nikt nie rozmawiał → wraca do „Nowe” (pierwszy kontakt), nie do „W kontakcie”
    expect(u).toMatchObject({ stage: "SYGNAL", nextStepType: "PIERWSZY_KONTAKT" });
    expect(u.nextStepNote).toBe(`wraca z odłożonych (inny powód) — zapytać o decyzję · woli popołudnie. Wcześniej: ${PHONE_NOTE}`);
    expect(String(u.nextStepNote).startsWith("wraca z odłożonych")).toBe(true);
    expect(db.activities.at(-1)?.body).toContain("Odłożone → Nowe");
    expect(u).not.toHaveProperty("firstContactAt");
  });

  it("po rozmowie powrót jak dotąd: W kontakcie, krok „dopytać”", async () => {
    db.due = [{ id: "L2", clientId: "C1", returnAt: new Date(2026, 9, 13, 9), postponeReason: "URLOP", nextStepNote: "wraca: urlop", firstContactAt: new Date(2026, 9, 1) }];
    await reviveReturningLeads(new Date(2026, 9, 13, 10));
    expect(db.updates[0]).toMatchObject({ stage: "WYWIAD", nextStepType: "DOPYTAC" });
    expect(db.activities.at(-1)?.body).toContain("Odłożone → W kontakcie");
  });
});

describe("Wynik rozmowy → Odłóż do… (prawdziwa rozmowa) — jak dotąd", () => {
  it("ustawia kontakt i wpis CALL, ale też zachowuje poprzednią notatkę kroku", async () => {
    await logLeadActivity("L1", { outcome: "postpone", body: "prosiła o kontakt po urlopie", nextActionAt: new Date(2026, 9, 20), postponeReason: "URLOP" }, "ania");
    const u = db.updates[0];
    expect(u.firstContactAt).toEqual(NOW);
    expect(u.lastContactAt).toEqual(NOW);
    expect(u).toMatchObject({ stage: "ODLOZONE", stepSource: "OUTCOME", nextStepType: "POWROT" });
    expect(db.activities[0].type).toBe("CALL");
    expect(u.nextStepNote).toBe(`wraca: urlop — prosiła o kontakt po urlopie. Wcześniej: ${PHONE_NOTE}`);
  });
});

describe("propozycja odlozenie: dopisek trafia do notatki", () => {
  const base = { rodzaj: "odlozenie", sygnal_id: "L1", data_powrotu: "2026-10-13", powod: "INNE", zrodlo: "decyzja Tomka", pewnosc: "wysoka", paczka: "P" };
  it("pole „dopisek” jest przyjmowane jak „notatka”", () => {
    expect(parseProposalItem({ ...base, dopisek: "woli popołudnie" })).toMatchObject({ ok: true, value: { kind: "POSTPONE", proposed: { returnAt: "2026-10-13", reason: "INNE", note: "woli popołudnie" } } });
    expect(parseProposalItem({ ...base, notatka: "z notatki" })).toMatchObject({ value: { proposed: { note: "z notatki" } } });
    expect(parseProposalItem({ ...base })).toMatchObject({ value: { proposed: { note: null } } });
  });
});
