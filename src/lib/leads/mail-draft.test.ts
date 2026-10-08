import { beforeEach, describe, expect, it, vi } from "vitest";

// Atrapa bazy w pamięci — tylko to, czego używa mail-draft.ts.
type Row = Record<string, unknown> & { id: string };
const db = { drafts: [] as Row[], activities: [] as Row[] };
let seq = 0;
const lead = { id: "L1", clientId: "C1", contactEmail: "klientka@example.com", client: { contacts: [{ email: "inny@example.com" }] } };
const inbound = { id: "E1", subject: "Wynajem Almy", sentAt: new Date() };

const matches = (row: Row, where: Record<string, unknown> | undefined) =>
  !where ||
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "in" in (v as object)) return ((v as { in: unknown[] }).in).includes(row[k]);
    return row[k] === v;
  });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findUnique: vi.fn(async () => lead) },
    user: { findUnique: vi.fn(async () => ({ name: "Klaudiusz" })) },
    emailMessage: {
      findFirst: vi.fn(async () => inbound),
      findUnique: vi.fn(async () => ({ id: "E1", subject: "Wynajem Almy", sentAt: new Date(), rfcMessageId: "<abc@mail>", gmailThreadId: "T1" })),
    },
    leadActivity: { create: vi.fn(async ({ data }: { data: Row }) => (db.activities.push({ ...data, id: `a${++seq}` }), data)) },
    leadEmailDraft: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => db.drafts.filter((d) => matches(d, where)).at(-1) ?? null),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => db.drafts.filter((d) => matches(d, where))),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { contentUpdatedAt: new Date(), gmailSavedAt: null, sentAt: null, updatedAt: new Date(), gmailDraftId: null, gmailThreadId: null, gmailMessageId: null, ...data, id: `d${++seq}` } as Row;
        db.drafts.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = db.drafts.find((d) => d.id === where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
  },
}));
vi.mock("@/lib/changelog/record", () => ({ recordChanges: vi.fn(async () => undefined) }));
vi.mock("@/lib/integrations/gmail", () => ({ GmailDraftGone: class extends Error {}, saveGmailDraft: vi.fn() }));
vi.mock("@/lib/leads/auto-mail", () => ({ AUTO_MAIL_FROM_NAME_KEY: "k", FOOTER_TEMPLATE_KEY: "f" }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));

const { upsertMailDraft, discardMailDraft, markDraftsSent, DraftError } = await import("./mail-draft");

const agent = { kind: "AGENT" as const, userId: "agent1" };
const user = { kind: "USER" as const, userId: "ania" };

beforeEach(() => {
  db.drafts.length = 0;
  db.activities.length = 0;
});

describe("upsertMailDraft", () => {
  it("agent tworzy szkic: odbiorca z sygnału, odpowiedź w wątku ostatniej wiadomości (Re: …), notatka zapisana", async () => {
    const d = await upsertMailDraft("L1", agent, { bodyText: "Dzień dobry,\n\nproponuję termin.", subject: undefined, note: "Pytała o Almę 8.10" }, { complete: false });
    expect(d).toMatchObject({ status: "PROPOZYCJA", authorKind: "AGENT", toAddress: "klientka@example.com", subject: "Re: Wynajem Almy", note: "Pytała o Almę 8.10", replyTo: { id: "E1" } });
    expect(db.activities.map((a) => a.body)).toEqual(["Szkic odpowiedzi przygotowany przez agenta"]);
  });

  it("agent: przy kompletnym wymaganiu brak treści/tematu → błąd, nic nie powstaje", async () => {
    await expect(upsertMailDraft("L1", agent, { bodyText: "x", subject: "", to: "zly" }, { complete: true })).rejects.toBeInstanceOf(DraftError);
    expect(db.drafts).toHaveLength(0);
  });

  it("jeden sygnał = jeden aktywny szkic: ponowne wywołanie aktualizuje ten sam", async () => {
    await upsertMailDraft("L1", agent, { bodyText: "v1" });
    await upsertMailDraft("L1", agent, { bodyText: "v2" });
    expect(db.drafts).toHaveLength(1);
    expect(db.drafts[0].bodyText).toBe("v2");
  });

  it("agent nie nadpisze szkicu poprawionego przez biuro bez nadpisz; z nadpisz — tak i zdejmuje znacznik poprawki", async () => {
    await upsertMailDraft("L1", agent, { bodyText: "propozycja agenta" });
    await upsertMailDraft("L1", user, { bodyText: "poprawione przez Anię" });
    expect(db.drafts[0].editedByUser).toBe(true);
    await expect(upsertMailDraft("L1", agent, { bodyText: "nowa propozycja" })).rejects.toMatchObject({ status: 409 });
    expect(db.drafts[0].bodyText).toBe("poprawione przez Anię");
    await upsertMailDraft("L1", agent, { bodyText: "nowa propozycja" }, { overwrite: true });
    expect(db.drafts[0]).toMatchObject({ bodyText: "nowa propozycja", editedByUser: false });
  });

  it("sama zmiana notatki nie liczy się jako zmiana treści (nie unieważnia zapisu w Gmailu)", async () => {
    await upsertMailDraft("L1", agent, { bodyText: "v1" });
    const before = db.drafts[0].contentUpdatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await upsertMailDraft("L1", agent, { note: "nowa notatka" });
    expect(db.drafts[0].contentUpdatedAt).toBe(before);
    expect(db.drafts[0].note).toBe("nowa notatka");
  });

  it("odpowiedz_na_mail brak (null) → nowy wątek", async () => {
    const d = await upsertMailDraft("L1", agent, { bodyText: "x", subject: "Oferta", replyToEmailId: null });
    expect(d.replyTo).toBeNull();
    expect(d.subject).toBe("Oferta");
  });
});

describe("discardMailDraft", () => {
  it("odrzucony szkic nie jest już aktywny; kolejny tworzy się od nowa", async () => {
    await upsertMailDraft("L1", agent, { bodyText: "v1" });
    await discardMailDraft("L1", user);
    expect(db.drafts[0].status).toBe("ODRZUCONY");
    await upsertMailDraft("L1", agent, { bodyText: "v2" });
    expect(db.drafts).toHaveLength(2);
    await expect(discardMailDraft("L-brak", user).then(() => discardMailDraft("L1", user)).then(() => discardMailDraft("L1", user))).rejects.toMatchObject({ status: 404 });
  });
});

describe("markDraftsSent", () => {
  const saved = new Date("2026-10-08T12:00:00Z");
  const seed = () => db.drafts.push({ id: "d9", leadId: "L1", clientId: "C1", status: "SZKIC_GMAIL", subject: "Re: Wynajem Almy", gmailThreadId: "T1", gmailSavedAt: saved });

  it("wysłana wiadomość w wątku szkicu → szkic „wysłany” i wpis w osi czasu", async () => {
    seed();
    const n = await markDraftsSent([{ direction: "OUT", gmailThreadId: "T1", gmailMessageId: "M7", sentAt: new Date("2026-10-08T12:30:00Z") }]);
    expect(n).toBe(1);
    expect(db.drafts[0]).toMatchObject({ status: "WYSLANY", gmailMessageId: "M7" });
    expect(db.activities.at(-1)?.body).toBe("Wysłano odpowiedź ze szkicu: Re: Wynajem Almy");
  });
  it("wiadomość przychodząca, inny wątek albo sprzed zapisu szkicu → bez zmian", async () => {
    seed();
    expect(await markDraftsSent([{ direction: "IN", gmailThreadId: "T1", gmailMessageId: "M1", sentAt: new Date("2026-10-08T12:30:00Z") }])).toBe(0);
    expect(await markDraftsSent([{ direction: "OUT", gmailThreadId: "T2", gmailMessageId: "M2", sentAt: new Date("2026-10-08T12:30:00Z") }])).toBe(0);
    expect(await markDraftsSent([{ direction: "OUT", gmailThreadId: "T1", gmailMessageId: "M3", sentAt: new Date("2026-10-08T10:00:00Z") }])).toBe(0);
    expect(db.drafts[0].status).toBe("SZKIC_GMAIL");
  });
});
