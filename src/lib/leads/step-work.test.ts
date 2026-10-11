import { beforeEach, describe, expect, it, vi } from "vitest";

// Wniosek 48 (B): Edytuj krok, Zmień termin i Wynik rozmowy odświeżają „ostatnią
// pracę” (lastWorkAt), ale nie ostatni kontakt z klientką; wpisy systemowe nie
// liczą się jako kontakt. Test na atrapie bazy: co zapisuje updateLead /
// logLeadActivity i jak to zmienia gnicie.

type Row = Record<string, unknown>;
const db = { lead: null as Row | null, updates: [] as Row[], activities: [] as Row[] };

vi.mock("@/lib/prisma", () => {
  const generic = () => new Proxy({}, { get: () => vi.fn(async () => null) });
  const prisma: Record<string, unknown> = {
    lead: {
      findUnique: vi.fn(async () => db.lead),
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

const { updateLead, logLeadActivity } = await import("./actions");
const { combineLastWork } = await import("./set-source");
const { WORK_ACTIVITY_TYPES } = await import("./last-work");
const { rotInfo } = await import("./funnel");

const at = (day: number, h = 12, month = 10) => new Date(2026, month - 1, day, h);
const NOW = new Date(2026, 9, 11, 12); // niedziela 11.10.2026 12:00

function staleLead(over: Row = {}): Row {
  return {
    id: "L1",
    title: "Gabinet",
    stage: "WYWIAD",
    clientId: "C1",
    ownerId: "u1",
    firstContactAt: at(1),
    lastContactAt: null,
    rentalId: null,
    nextStepType: "ODDZWONI",
    nextStepNote: null,
    nextActionAt: at(5), // zaległy
    attempts: 0,
    followUpNo: 0,
    ...over,
  };
}

// FunnelLead z tego, co zapisały updateLead / logLeadActivity, plus stan z bazy.
function funnelAfter(update: Row, base: Row) {
  const merged = { ...base, ...update } as Row;
  return {
    id: "L1",
    stage: merged.stage as never,
    type: "INNE" as never,
    createdAt: at(1),
    firstContactAt: at(1),
    lastContactAt: (merged.lastContactAt as Date | null) ?? null,
    stageChangedAt: at(1),
    nextActionAt: (merged.nextActionAt as Date | null) ?? null,
    nextStepType: (merged.nextStepType as string | null) ?? null,
    attempts: 0,
    ownerId: null,
    rentalId: null,
    phone: null,
    lastWorkAt: combineLastWork(null, merged.stepSource as string, merged.stepSourceAt as Date),
  };
}

beforeEach(() => {
  db.lead = staleLead();
  db.updates = [];
  db.activities = [];
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("praca na kroku odświeża lastWorkAt", () => {
  it("bazowo: sygnał z zaległym krokiem sprzed tygodnia gnije", () => {
    expect(rotInfo(funnelAfter({}, staleLead()), NOW).rotting).toBe(true);
  });

  it("Edytuj krok (rodzaj i opis): źródło USER i znacznik czasu, bez lastContactAt", async () => {
    await updateLead("L1", { nextStepType: "DOPYTAC", nextStepNote: "zapytać o termin" } as never, "ania");
    const u = db.updates[0];
    expect(u).toMatchObject({ stepSource: "USER", stepSourceById: "ania", nextStepType: "DOPYTAC", nextStepNote: "zapytać o termin" });
    expect((u.stepSourceAt as Date).getTime()).toBe(NOW.getTime());
    expect(u).not.toHaveProperty("lastContactAt");
    // wpis na osi czasu to SYSTEM (nie kontakt, nie liczy się do raportu „puls”)
    expect(db.activities.every((a) => a.type === "SYSTEM")).toBe(true);
    expect((WORK_ACTIVITY_TYPES as readonly string[]).includes("SYSTEM")).toBe(false);
    // …a mimo to licznik gnicia jest świeży
    expect(combineLastWork(null, u.stepSource as string, u.stepSourceAt as Date)?.getTime()).toBe(NOW.getTime());
  });

  it("Zmień termin: źródło USER, nowy termin w przyszłości → sygnał nie gnije (A+B)", async () => {
    const next = at(16, 9);
    await updateLead("L1", { nextActionAt: next } as never, "ania");
    const u = db.updates[0];
    expect(u).toMatchObject({ stepSource: "USER", nextActionAt: next });
    expect(u).not.toHaveProperty("lastContactAt");
    expect(rotInfo(funnelAfter(u, staleLead()), NOW).rotting).toBe(false);
  });

  it("Zmień termin na zaległy: odświeża pracę, ale sygnał gnije, gdy nadal po terminie i po limicie", async () => {
    const next = at(2, 9);
    await updateLead("L1", { nextActionAt: next } as never, "ania");
    const f = funnelAfter(db.updates[0], staleLead());
    expect(f.lastWorkAt?.getTime()).toBe(NOW.getTime());
    // praca była „dziś”, więc 3 dni rob. jeszcze nie minęły — nie gnije mimo zaległego terminu
    expect(rotInfo(f, NOW).rotting).toBe(false);
  });

  it("Wynik rozmowy: wpis CALL (praca) + źródło OUTCOME, lastContactAt ustawia tylko prawdziwy kontakt", async () => {
    await logLeadActivity("L1", { outcome: "callback", body: null, nextActionAt: at(16, 9) }, "ania");
    const u = db.updates[0];
    expect(u).toMatchObject({ stepSource: "OUTCOME", nextStepType: "ODDZWONI" });
    expect(db.activities[0].type).toBe("CALL");
    expect((WORK_ACTIVITY_TYPES as readonly string[]).includes(db.activities[0].type as string)).toBe(true);
    expect(rotInfo(funnelAfter(u, staleLead()), NOW).rotting).toBe(false);
  });

  it("Nie odebrała: wpis CALL_NO_ANSWER liczy się jako praca, lastContactAt bez zmian", async () => {
    await logLeadActivity("L1", { outcome: "no_answer", body: null }, "ania");
    expect(db.activities[0].type).toBe("CALL_NO_ANSWER");
    expect(db.updates[0]).not.toHaveProperty("lastContactAt");
  });
});
