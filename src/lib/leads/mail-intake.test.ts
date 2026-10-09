import { beforeEach, describe, expect, it, vi } from "vitest";

// Atrapa bazy w pamięci — tylko to, czego używa mail-intake.ts.
type Row = Record<string, unknown> & { id: string };
const db = { intakes: [] as Row[], openLeadClients: new Set<string>(), contactsByPhone: new Map<string, { id: string; name: string }>() };
let seq = 0;
let bodyText = "";
const createLeadMock = vi.fn(async () => "LEAD1");

const matches = (row: Row, where: Record<string, unknown> | undefined) =>
  !where ||
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "in" in (v as object)) return (v as { in: unknown[] }).in.includes(row[k]);
    if (v && typeof v === "object" && "not" in (v as object)) return row[k] !== (v as { not: unknown }).not;
    if (v && typeof v === "object" && "gte" in (v as object)) return (row[k] as Date) >= (v as { gte: Date }).gte;
    return row[k] === v;
  });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    setting: { findUnique: vi.fn(async () => null) },
    mailIntake: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => db.intakes.filter((r) => matches(r, where))),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => db.intakes.filter((r) => matches(r, where)).length),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { ...data, id: `i${++seq}`, createdAt: new Date() } as Row;
        db.intakes.push(row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.intakes.find((r) => r.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(db.intakes.find((r) => r.id === where.id)!, data)),
    },
    lead: {
      count: vi.fn(async ({ where }: { where: { clientId: string } }) => (db.openLeadClients.has(where.clientId) ? 1 : 0)),
      findUnique: vi.fn(async () => ({ clientId: null })),
      findFirst: vi.fn(async () => null),
    },
    clientContact: { findFirst: vi.fn(async ({ where }: { where: { OR: { phone: string }[] } }) => ({ client: db.contactsByPhone.get(where.OR[0].phone) ?? null })) },
    client: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    emailMessage: { createMany: vi.fn(async () => ({ count: 0 })) },
    leadActivity: { create: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/lib/integrations/gmail-read", () => ({ getMessageFull: vi.fn(async () => ({ text: bodyText, html: null })) }));
vi.mock("@/lib/leads/actions", () => ({ createLead: createLeadMock, LeadError: class extends Error {} }));
vi.mock("@/lib/leads/offer-draft", () => ({ freeDatesFor: vi.fn(async () => []) }));
vi.mock("@/lib/changelog/record", () => ({ recordChanges: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));

const { processMailIntake, rejectIntake, setRecommendation, IntakeError } = await import("./mail-intake");

const MAILBOX = "kontakt@wynajemlasera.pl";
const ctx = { isOwn: (a: string) => a === MAILBOX, excluded: () => false };

function cand(over: { id?: string; from?: string; subject?: string; snippet?: string; labels?: string[]; headers?: Record<string, string>; known?: { clientId: string; direction: "IN" | "OUT" } | null; ageMs?: number }) {
  const from = over.from ?? "anna@gmail.com";
  return {
    meta: { id: over.id ?? `m${++seq}`, threadId: "T1", labelIds: over.labels ?? ["INBOX"], snippet: over.snippet ?? "", internalDate: Date.now() - (over.ageMs ?? 60_000), headers: [], hasAttachments: false },
    headers: { from: `Anna <${from}>`, subject: over.subject ?? "", "message-id": "<x@y>", ...over.headers },
    from: [from],
    to: [MAILBOX],
    cc: [],
    known: over.known ? ({ ...over.known, clientContactId: null, matchMethod: "EMAIL", counterpart: from } as never) : null,
  };
}

beforeEach(() => {
  db.intakes.length = 0;
  db.openLeadClients.clear();
  db.contactsByPhone.clear();
  bodyText = "";
  createLeadMock.mockClear();
});

describe("processMailIntake", () => {
  it("odrzuca no-reply jako SMIEC z powodem i nie zakłada sygnału", async () => {
    const r = await processMailIntake(MAILBOX, [cand({ from: "no-reply@sklep.pl", subject: "Potwierdzenie" })], ctx);
    expect(r.rejected).toBe(1);
    expect(db.intakes[0]).toMatchObject({ status: "SMIEC", fromAddress: "no-reply@sklep.pl" });
    expect(createLeadMock).not.toHaveBeenCalled();
  });

  it("nowa osoba z wysoką punktacją trafia do „Do sprawdzenia” (tryb ostrożny), bez sygnału", async () => {
    bodyText = "Dzień dobry, chcę wynająć Lightsheer na weekend. Proszę o ofertę i cennik. Tel. 601 234 567";
    const r = await processMailIntake(MAILBOX, [cand({ subject: "Wynajem lasera", snippet: "chcę wynająć Lightsheer" })], ctx);
    expect(r.queued).toBe(1);
    expect(db.intakes[0]).toMatchObject({ status: "DO_SPRAWDZENIA", kind: "NEW_PERSON" });
    expect(db.intakes[0].score as number).toBeGreaterThan(0);
    expect(createLeadMock).not.toHaveBeenCalled();
  });

  it("niska punktacja → AUTO_ODRZUCONY (widoczne 14 dni)", async () => {
    bodyText = "Pozdrawiam, zapraszamy na webinar o marketingu";
    const r = await processMailIntake(MAILBOX, [cand({ subject: "Oferta współpracy", snippet: "marketing" })], ctx);
    expect(r.rejected).toBe(1);
    expect(db.intakes[0].status).toBe("AUTO_ODRZUCONY");
  });

  it("klientka z bazy z prośbą o wynajem i bez otwartego sygnału → „Do sprawdzenia” (KNOWN_CLIENT)", async () => {
    const r = await processMailIntake(MAILBOX, [cand({ subject: "Chcę wynająć laser", known: { clientId: "C1", direction: "IN" } })], ctx);
    expect(r.queued).toBe(1);
    expect(db.intakes[0]).toMatchObject({ kind: "KNOWN_CLIENT", status: "DO_SPRAWDZENIA", clientId: "C1" });
  });

  it("klientka z bazy z otwartym sygnałem → nic (zwykła historia)", async () => {
    db.openLeadClients.add("C1");
    const r = await processMailIntake(MAILBOX, [cand({ subject: "Chcę wynająć laser", known: { clientId: "C1", direction: "IN" } })], ctx);
    expect(r).toEqual({ created: 0, queued: 0, rejected: 0 });
    expect(db.intakes).toHaveLength(0);
  });

  it("klientka z bazy bez słów o wynajmie → nic", async () => {
    const r = await processMailIntake(MAILBOX, [cand({ subject: "Dziękuję za fakturę", known: { clientId: "C1", direction: "IN" } })], ctx);
    expect(r.queued).toBe(0);
    expect(db.intakes).toHaveLength(0);
  });

  it("ten sam mail nie jest przetwarzany dwa razy (idempotencja po id wiadomości)", async () => {
    bodyText = "Chcę wynająć Lightsheer, proszę o ofertę";
    const c = cand({ id: "same", subject: "Wynajem lasera" });
    await processMailIntake(MAILBOX, [c], ctx);
    await processMailIntake(MAILBOX, [c], ctx);
    expect(db.intakes).toHaveLength(1);
  });

  it("ten sam nadawca w ciągu 30 dni nie dubluje pozycji", async () => {
    bodyText = "Chcę wynająć Lightsheer, proszę o ofertę";
    await processMailIntake(MAILBOX, [cand({ subject: "Wynajem lasera" })], ctx);
    await processMailIntake(MAILBOX, [cand({ subject: "Wynajem lasera - ponowienie" })], ctx);
    expect(db.intakes).toHaveLength(1);
  });

  it("pomija stare maile (backfill) i maile spoza INBOX", async () => {
    bodyText = "Chcę wynająć Lightsheer";
    const r = await processMailIntake(MAILBOX, [cand({ ageMs: 10 * 86_400_000, from: "a@x.pl" }), cand({ labels: ["SENT"], from: "b@x.pl" })], ctx);
    expect(r).toEqual({ created: 0, queued: 0, rejected: 0 });
    expect(db.intakes).toHaveLength(0);
  });

  it("telefon z treści pasujący do klientki z bazy → KNOWN_CLIENT do sprawdzenia", async () => {
    bodyText = "Dzień dobry, proszę o wynajem lasera. Mój numer 601 234 567";
    db.contactsByPhone.set("+48601234567", { id: "C9", name: "Salon Anna" });
    const r = await processMailIntake(MAILBOX, [cand({ subject: "Wynajem", from: "nowy@gmail.com" })], ctx);
    expect(r.queued).toBe(1);
    expect(db.intakes[0]).toMatchObject({ kind: "KNOWN_CLIENT", clientId: "C9" });
  });
});

describe("decyzje człowieka i rekomendacja", () => {
  it("rejectIntake oznacza ODRZUCONY_RECZNIE, ale nie ruszy pozycji z sygnałem", async () => {
    db.intakes.push({ id: "a", status: "DO_SPRAWDZENIA" }, { id: "b", status: "SYGNAL" });
    await rejectIntake("a", "ania");
    expect(db.intakes[0]).toMatchObject({ status: "ODRZUCONY_RECZNIE", decidedById: "ania" });
    await expect(rejectIntake("b", "ania")).rejects.toBeInstanceOf(IntakeError);
    await expect(rejectIntake("zzz", "ania")).rejects.toBeInstanceOf(IntakeError);
  });

  it("rekomendacja agenta jest tylko zapisem pola — status zostaje", async () => {
    db.intakes.push({ id: "a", status: "DO_SPRAWDZENIA" });
    await setRecommendation("a", "SYGNAL", "Pyta o Lightsheer");
    expect(db.intakes[0]).toMatchObject({ status: "DO_SPRAWDZENIA", recommendation: "SYGNAL", recommendationNote: "Pyta o Lightsheer" });
    expect(createLeadMock).not.toHaveBeenCalled();
  });
});
