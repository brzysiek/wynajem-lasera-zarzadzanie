import { beforeEach, describe, expect, it, vi } from "vitest";

// Wniosek 42, pkt 5: propozycja połączenia po imieniu i nazwisku (nigdy automat),
// plakietki na obu sygnałach, „Połącz” (zostaje starszy sygnał) i „To ktoś inny”.

type Row = Record<string, unknown> & { id: string };
const db = {
  leads: [] as Row[],
  candidates: [] as Row[],
  clients: [] as Row[],
  suggestions: [] as Row[],
  calls: [] as { op: string; args: unknown }[],
  stubClient: true,
};
let seq = 0;

vi.mock("@/lib/prisma", () => {
  const rec = (op: string, ret: unknown = {}) => vi.fn(async (args: unknown) => (db.calls.push({ op, args }), ret));
  const prisma: Record<string, unknown> = {
    lead: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.leads.find((l) => l.id === where.id) ?? null),
      findMany: vi.fn(async () => db.candidates),
      update: rec("lead.update"),
      count: vi.fn(async () => (db.stubClient ? 0 : 1)),
    },
    client: { findMany: vi.fn(async () => db.clients), findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.clients.find((c) => c.id === where.id) ?? null) },
    rental: { count: vi.fn(async () => 0) },
    rentalHistory: { count: vi.fn(async () => 0) },
    clientInvoice: { count: vi.fn(async () => 0) },
    leadActivity: { updateMany: rec("activity.move"), create: rec("activity.create") },
    chatThread: { updateMany: rec("thread.move") },
    leadMergeSuggestion: {
      findMany: vi.fn(async () => db.suggestions.filter((s) => s.status === "PENDING" || s.status === "DISMISSED")),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.suggestions.find((s) => s.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => (db.suggestions.push({ status: "PENDING", ...data, id: `s${++seq}` }), {})),
      update: rec("sug.update"),
      updateMany: rec("sug.updateMany"),
      count: vi.fn(async () => db.suggestions.filter((s) => s.status === "PENDING").length),
    },
    $transaction: vi.fn(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => unknown)(prisma))),
  };
  return { prisma };
});
const archiveRecords = vi.fn(async () => 1);
vi.mock("@/lib/porzadki/archive", () => ({ archiveRecords }));
vi.mock("@/lib/changelog/record", () => ({ recordChanges: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));

const { suggestMergesForLead, mergeSuggestion, dismissMerge, MergeError } = await import("./merge");

const lead = (over: Row): Row => ({ type: "MESSENGER", contactName: null, clientId: null, client: null, title: "t", stage: "SYGNAL", clientContactId: null, contactPhone: null, contactEmail: null, firstContactAt: null, lastContactAt: null, nextActionAt: null, nextStepType: null, nextStepNote: null, createdAt: new Date(2026, 9, 28), stageChangedAt: new Date(2026, 9, 28), ...over });
const actor = { userId: "ania", role: "STAFF" };

beforeEach(() => {
  db.leads = [];
  db.candidates = [];
  db.clients = [];
  db.suggestions = [];
  db.calls = [];
  db.stubClient = true;
  archiveRecords.mockClear();
});

describe("suggestMergesForLead", () => {
  it("sygnał z Messengera: propozycja dla otwartego sygnału i dla klientki z tym imieniem", async () => {
    db.leads = [lead({ id: "M1", contactName: "Anna Klęczar" })];
    db.candidates = [lead({ id: "E1", type: "EMAIL", contactName: "Klęczar Anna" }), lead({ id: "E2", type: "EMAIL", contactName: "Jan Nowak" })];
    db.clients = [{ id: "C1", name: "Anna Klęczar", contacts: [] }, { id: "C2", name: "Ewa Zielona", contacts: [{ firstName: "Anna", lastName: "Klęczar" }] }, { id: "C3", name: "Inna Osoba", contacts: [] }];
    expect(await suggestMergesForLead("M1")).toBe(3);
    expect(db.suggestions.map((s) => [s.otherLeadId ?? null, s.otherClientId ?? null])).toEqual([["E1", null], [null, "C1"], [null, "C2"]]);
  });

  it("samo imię (jedno słowo) nie daje propozycji", async () => {
    db.leads = [lead({ id: "M1", contactName: "Anna" })];
    db.candidates = [lead({ id: "E1", type: "EMAIL", contactName: "Anna Klęczar" })];
    expect(await suggestMergesForLead("M1")).toBe(0);
  });

  it("sygnał z maila: porównuje tylko z otwartymi sygnałami z czatu, bez klientek", async () => {
    db.leads = [lead({ id: "E1", type: "EMAIL", contactName: "Anna Klęczar" })];
    db.candidates = [lead({ id: "M1", contactName: "Anna Klęczar" })];
    db.clients = [{ id: "C1", name: "Anna Klęczar", contacts: [] }];
    expect(await suggestMergesForLead("E1")).toBe(1);
    expect(db.suggestions[0]).toMatchObject({ leadId: "E1", otherLeadId: "M1" });
  });

  it("nie dubluje propozycji (także odrzuconej)", async () => {
    db.leads = [lead({ id: "M1", contactName: "Anna Klęczar" })];
    db.candidates = [lead({ id: "E1", type: "EMAIL", contactName: "Anna Klęczar" })];
    db.suggestions = [{ id: "old", status: "DISMISSED", leadId: "E1", otherLeadId: "M1", otherClientId: null }];
    expect(await suggestMergesForLead("M1")).toBe(0);
  });
});

describe("mergeSuggestion", () => {
  it("sygnał ↔ sygnał: zostaje starszy, aktywności i czat przechodzą, nowszy do archiwum jako duplikat", async () => {
    db.leads = [
      lead({ id: "OLD", type: "EMAIL", createdAt: new Date(2026, 9, 20), contactName: "Anna Klęczar", clientId: "C-old", stage: "WYWIAD" }),
      lead({ id: "NEW", type: "MESSENGER", createdAt: new Date(2026, 9, 28), contactName: "Anna Klęczar", clientId: "C-stub", contactPhone: "+48601234567" }),
    ];
    db.suggestions = [{ id: "S1", status: "PENDING", leadId: "NEW", otherLeadId: "OLD", otherClientId: null }];
    const r = await mergeSuggestion("S1", actor);
    expect(r.leadId).toBe("OLD");
    expect(db.calls.find((c) => c.op === "activity.move")?.args).toMatchObject({ where: { leadId: "NEW" }, data: { leadId: "OLD" } });
    expect(db.calls.find((c) => c.op === "thread.move")?.args).toMatchObject({ where: { leadId: "NEW" }, data: { leadId: "OLD", clientId: "C-old" } });
    expect(db.calls.find((c) => c.op === "lead.update")?.args).toMatchObject({ where: { id: "OLD" }, data: { contactPhone: "+48601234567" } });
    expect(archiveRecords).toHaveBeenCalledWith("lead", ["NEW"], expect.objectContaining({ reason: "DUPLIKAT" }), actor);
    // konto założone automatycznie przy sygnale z czatu też idzie do archiwum
    expect(archiveRecords).toHaveBeenCalledWith("client", ["C-stub"], expect.objectContaining({ reason: "DUPLIKAT" }), actor);
  });

  it("konto z historią (nie „stub”) zostaje", async () => {
    db.stubClient = false;
    db.leads = [lead({ id: "OLD", type: "EMAIL", createdAt: new Date(2026, 9, 20), clientId: "C-old" }), lead({ id: "NEW", createdAt: new Date(2026, 9, 28), clientId: "C-real" })];
    db.suggestions = [{ id: "S1", status: "PENDING", leadId: "NEW", otherLeadId: "OLD", otherClientId: null }];
    await mergeSuggestion("S1", actor);
    expect(archiveRecords).toHaveBeenCalledTimes(1);
    expect(archiveRecords).toHaveBeenCalledWith("lead", ["NEW"], expect.anything(), actor);
  });

  it("sygnał ↔ klientka: sygnał przechodzi do klientki, konto-stub archiwizowane", async () => {
    db.leads = [lead({ id: "M1", contactName: "Anna Klęczar", clientId: "C-stub" })];
    db.clients = [{ id: "C1", name: "Anna Klęczar", contacts: [{ id: "CC1" }] }];
    db.suggestions = [{ id: "S2", status: "PENDING", leadId: "M1", otherLeadId: null, otherClientId: "C1" }];
    const r = await mergeSuggestion("S2", actor);
    expect(r.leadId).toBe("M1");
    expect(db.calls.find((c) => c.op === "lead.update")?.args).toMatchObject({ where: { id: "M1" }, data: { client: { connect: { id: "C1" } }, clientContact: { connect: { id: "CC1" } } } });
    expect(archiveRecords).toHaveBeenCalledWith("client", ["C-stub"], expect.anything(), actor);
  });

  it("rozstrzygnięta propozycja nie wykona się drugi raz", async () => {
    db.suggestions = [{ id: "S3", status: "MERGED", leadId: "A", otherLeadId: "B" }];
    await expect(mergeSuggestion("S3", actor)).rejects.toBeInstanceOf(MergeError);
    await expect(dismissMerge("S3", "ania")).rejects.toBeInstanceOf(MergeError);
    await expect(mergeSuggestion("brak", actor)).rejects.toMatchObject({ status: 404 });
  });
});

describe("dismissMerge", () => {
  it("„To ktoś inny” chowa propozycję bez scalania", async () => {
    db.suggestions = [{ id: "S4", status: "PENDING", leadId: "A", otherLeadId: "B" }];
    await dismissMerge("S4", "ania");
    expect(db.calls.find((c) => c.op === "sug.update")?.args).toMatchObject({ where: { id: "S4" }, data: { status: "DISMISSED", decidedById: "ania" } });
    expect(archiveRecords).not.toHaveBeenCalled();
  });
});
