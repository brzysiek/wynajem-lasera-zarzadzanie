import { beforeEach, describe, expect, it, vi } from "vitest";

type Sug = { id: string; leadId: string; text: string; basis: string | null; authorId: string | null; generatedAt: Date; coveredUntil: Date; requestedAt: Date | null };
const db = { sug: null as Sug | null, acts: [] as { leadId: string; type: string; body: string | null; createdAt: Date }[], mails: [] as { clientId: string; sentAt: Date }[] };
const lead = { id: "L1", clientId: "C1", createdAt: new Date("2026-10-01T08:00:00Z"), suggestion: null as { id: string } | null };
const changes: unknown[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findUnique: vi.fn(async () => ({ ...lead, suggestion: db.sug ? { id: db.sug.id } : null })) },
    user: { findUnique: vi.fn(async () => ({ name: "Klaudiusz" })) },
    leadActivity: {
      findMany: vi.fn(async ({ where, take }: { where: { createdAt?: { gt: Date } }; take?: number }) =>
        db.acts
          .filter((a) => !where.createdAt || a.createdAt > where.createdAt.gt)
          .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
          .slice(0, take ?? 1000),
      ),
    },
    emailMessage: {
      findFirst: vi.fn(async () => [...db.mails].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0] ?? null),
      findMany: vi.fn(async ({ where }: { where: { sentAt?: { gt: Date } } }) => db.mails.filter((m) => !where.sentAt || m.sentAt > where.sentAt.gt)),
    },
    leadSuggestion: {
      findUnique: vi.fn(async () => db.sug),
      upsert: vi.fn(async ({ create, update }: { create: Sug; update: Partial<Sug> }) => {
        db.sug = db.sug ? ({ ...db.sug, ...update } as Sug) : ({ ...create, id: "S1" } as Sug);
        return db.sug;
      }),
      update: vi.fn(async ({ data }: { data: Partial<Sug> }) => {
        db.sug = { ...db.sug!, ...data };
        return db.sug;
      }),
      aggregate: vi.fn(async () => ({ _max: { generatedAt: db.sug?.generatedAt ?? null } })),
    },
  },
}));
vi.mock("@/lib/changelog/record", () => ({ recordChanges: vi.fn(async (_db: unknown, _a: unknown, e: unknown[]) => void changes.push(...e)) }));

const { saveSuggestion, requestSuggestionUpdate, loadSuggestion, SuggestionError } = await import("./lead-suggestion");

beforeEach(() => {
  db.sug = null;
  db.acts = [];
  db.mails = [];
  changes.length = 0;
});

describe("saveSuggestion", () => {
  it("zapisuje, zapamiętuje najnowszy wpis osi czasu (bez pracy przy szkicu) i wpisuje do dziennika tylko fakt zapisu", async () => {
    db.acts = [
      { leadId: "L1", type: "CALL", body: "rozmowa", createdAt: new Date("2026-10-08T10:00:00Z") },
      { leadId: "L1", type: "SYSTEM", body: "Szkic odpowiedzi przygotowany przez agenta", createdAt: new Date("2026-10-09T05:00:00Z") },
    ];
    await saveSuggestion("L1", "agent1", "  Sugeruję zadzwonić po 15:00.  ", "notatki z 8.10");
    expect(db.sug).toMatchObject({ text: "Sugeruję zadzwonić po 15:00.", basis: "notatki z 8.10", authorId: "agent1", requestedAt: null });
    expect(db.sug!.coveredUntil).toEqual(new Date("2026-10-08T10:00:00Z"));
    expect(changes).toEqual([expect.objectContaining({ entity: "LEAD", operation: "CREATE", field: "sugestia", after: "zapisana" })]);
    expect(JSON.stringify(changes)).not.toContain("zadzwonić");
  });

  it("ponowny zapis nadpisuje i czyści prośbę o aktualizację", async () => {
    await saveSuggestion("L1", "agent1", "Sugeruję A.", null);
    await requestSuggestionUpdate("L1");
    expect(db.sug!.requestedAt).toBeInstanceOf(Date);
    await saveSuggestion("L1", "agent1", "Sugeruję B.", null);
    expect(db.sug).toMatchObject({ text: "Sugeruję B.", requestedAt: null });
    expect(changes.at(-1)).toMatchObject({ operation: "FIELD_CHANGE" });
  });

  it("odrzuca puste, za długie i HTML", async () => {
    await expect(saveSuggestion("L1", "a", "  ", null)).rejects.toBeInstanceOf(SuggestionError);
    await expect(saveSuggestion("L1", "a", "x".repeat(401), null)).rejects.toBeInstanceOf(SuggestionError);
    await expect(saveSuggestion("L1", "a", "Sugeruję <b>tak</b>", null)).rejects.toBeInstanceOf(SuggestionError);
    expect(db.sug).toBeNull();
  });
});

describe("requestSuggestionUpdate", () => {
  it("bez sugestii → 404", async () => {
    await expect(requestSuggestionUpdate("L1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("loadSuggestion", () => {
  it("brak sugestii → null", async () => expect(await loadSuggestion("L1", "C1")).toBeNull());

  it("nowe wpisy po sugestii (aktywność i maile) przygaszają ją; praca przy szkicu nie", async () => {
    db.sug = { id: "S1", leadId: "L1", text: "Sugeruję A.", basis: null, authorId: "agent1", generatedAt: new Date("2026-10-09T07:30:00Z"), coveredUntil: new Date("2026-10-09T07:00:00Z"), requestedAt: null };
    expect((await loadSuggestion("L1", "C1"))!).toMatchObject({ stale: false, newEntries: 0, authorName: "Klaudiusz" });
    db.acts = [
      { leadId: "L1", type: "SYSTEM", body: "Szkic odpowiedzi zapisany w Gmailu: Re: X", createdAt: new Date("2026-10-09T08:00:00Z") },
      { leadId: "L1", type: "CALL", body: "rozmowa", createdAt: new Date("2026-10-09T09:00:00Z") },
    ];
    db.mails = [{ clientId: "C1", sentAt: new Date("2026-10-09T09:30:00Z") }];
    const s = (await loadSuggestion("L1", "C1"))!;
    expect(s).toMatchObject({ stale: true, newEntries: 2, requestPending: false });
    expect(s.lastRunAt).toBe("2026-10-09T07:30:00.000Z");
  });

  it("prośba czeka do następnej sugestii", async () => {
    db.sug = { id: "S1", leadId: "L1", text: "Sugeruję A.", basis: null, authorId: null, generatedAt: new Date("2026-10-09T07:30:00Z"), coveredUntil: new Date("2026-10-09T07:00:00Z"), requestedAt: new Date("2026-10-09T08:00:00Z") };
    expect((await loadSuggestion("L1", null))!.requestPending).toBe(true);
  });
});
