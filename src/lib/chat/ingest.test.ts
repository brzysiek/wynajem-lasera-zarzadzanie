import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MetaEvent } from "./meta-rules";

// Wniosek 42: odbiór wiadomości z Messengera / Instagrama → wątek, sygnał,
// przesunięcie po naszej odpowiedzi, twarde klucze. Atrapa bazy w pamięci.

type Row = Record<string, unknown> & { id: string };
const db = { threads: [] as Row[], messages: [] as Row[], leadUpdates: [] as { id: string; data: Row }[], activities: [] as Row[], openLead: null as Row | null, contact: null as Row | null };
let seq = 0;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: {
      findUnique: vi.fn(async ({ where }: { where: { mid: string } }) => db.messages.find((m) => m.mid === where.mid) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => (db.messages.push({ ...data, id: `m${++seq}` }), {})),
    },
    chatThread: {
      findUnique: vi.fn(async ({ where }: { where: { channel_externalUserId: { channel: string; externalUserId: string } } }) => db.threads.find((t) => t.channel === where.channel_externalUserId.channel && t.externalUserId === where.channel_externalUserId.externalUserId) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const t = { lastInboundAt: null, lastOutboundAt: null, leadId: null, clientId: null, ...data, id: `t${++seq}` } as Row;
        db.threads.push(t);
        return t;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(db.threads.find((t) => t.id === where.id)!, data)),
    },
    lead: {
      findFirst: vi.fn(async () => db.openLead),
      findUnique: vi.fn(async () => ({ clientId: "C-new" })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => (db.leadUpdates.push({ id: where.id, data }), {})),
    },
    leadActivity: { create: vi.fn(async ({ data }: { data: Row }) => (db.activities.push(data), {})) },
    clientContact: { findFirst: vi.fn(async () => db.contact) },
  },
}));
const createLead = vi.fn<(...args: unknown[]) => Promise<string>>(async () => "LEAD1");
vi.mock("@/lib/leads/actions", () => ({ createLead }));
const suggest = vi.fn<(...args: unknown[]) => Promise<number>>(async () => 0);
vi.mock("./merge", () => ({ suggestMergesForLead: suggest }));
vi.mock("@/lib/history/invoices", () => ({ interestsFromText: (t: string | null) => (t?.includes("Alm") ? ["ALMA_HARMONY", "SZKOLENIE"] : []) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));

const { ingestMetaEvents } = await import("./ingest");

const ev = (over: Partial<MetaEvent> = {}): MetaEvent => ({ channel: "MESSENGER", pageId: "P1", userId: "U1", mid: `mid${++seq}`, text: "Dzień dobry", attachments: [], at: new Date(2026, 9, 28, 12), outbound: false, ...over });

beforeEach(() => {
  db.threads.length = 0;
  db.messages.length = 0;
  db.leadUpdates.length = 0;
  db.activities.length = 0;
  db.openLead = null;
  db.contact = null;
  createLead.mockClear();
  suggest.mockClear();
  delete process.env.META_PAGE_ACCESS_TOKEN;
});

describe("ingestMetaEvents", () => {
  it("nowa rozmowa: wątek, wiadomość i sygnał typu Messenger ze źródłem „automat”", async () => {
    const r = await ingestMetaEvents([ev({ text: "Czy wynajmujecie Almę? Tel 601 234 567" })]);
    expect(r).toEqual({ stored: 1, duplicates: 0, leads: 1 });
    expect(db.threads[0]).toMatchObject({ channel: "MESSENGER", externalUserId: "U1", leadId: "LEAD1", clientId: "C-new" });
    expect(db.messages[0]).toMatchObject({ direction: "IN", text: "Czy wynajmujecie Almę? Tel 601 234 567" });
    const [input, user, opts] = createLead.mock.calls[0] as unknown as [Record<string, unknown>, string | null, { source: string; createdAt: Date }];
    expect(input).toMatchObject({ type: "MESSENGER", contactPhone: "+48601234567", deviceInterest: ["ALMA_HARMONY"], contactName: "Messenger 'U1'".replace("'U1'", "U1".slice(-4)) });
    expect(String(input.sourceRef)).toMatch(/^meta:MESSENGER:U1#mid/);
    expect(user).toBeNull();
    expect(opts).toMatchObject({ source: "AUTO_CHAT", createdAt: new Date(2026, 9, 28, 12) });
    expect(db.activities.some((a) => String(a.body).startsWith("Sygnał z Messengera"))).toBe(true);
    expect(suggest).toHaveBeenCalledWith("LEAD1");
  });

  it("imię z Graph API trafia do sygnału (gdy jest token)", async () => {
    process.env.META_PAGE_ACCESS_TOKEN = "tok";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ name: "Anna Klęczar" }) })));
    await ingestMetaEvents([ev()]);
    vi.unstubAllGlobals();
    expect(createLead.mock.calls[0][0]).toMatchObject({ contactName: "Anna Klęczar" });
    expect(db.threads[0].displayName).toBe("Anna Klęczar");
  });

  it("ta sama wiadomość dwa razy: jeden zapis, jeden sygnał", async () => {
    const e = ev();
    await ingestMetaEvents([e]);
    const again = await ingestMetaEvents([e]);
    expect(again).toMatchObject({ stored: 0, duplicates: 1, leads: 0 });
    expect(createLead).toHaveBeenCalledTimes(1);
    expect(db.messages).toHaveLength(1);
  });

  it("nasza odpowiedź (echo) przesuwa nowy sygnał do „W kontakcie” z pierwszym kontaktem", async () => {
    await ingestMetaEvents([ev()]);
    db.openLead = { id: "LEAD1", clientId: "C-new", stage: "SYGNAL", firstContactAt: null, lastContactAt: null, nextActionAt: new Date(2026, 9, 28, 16), contactPhone: null, contactEmail: null };
    await ingestMetaEvents([ev({ outbound: true, text: "Tak, zapraszam", at: new Date(2026, 9, 28, 13) })]);
    const u = db.leadUpdates.at(-1)!;
    expect(u.id).toBe("LEAD1");
    expect(u.data).toMatchObject({ stage: "WYWIAD", firstContactAt: new Date(2026, 9, 28, 13), lastContactAt: new Date(2026, 9, 28, 13), stageSource: "AUTO_CHAT" });
    expect(db.threads[0].lastOutboundAt).toEqual(new Date(2026, 9, 28, 13));
    expect(createLead).toHaveBeenCalledTimes(1);
  });

  it("kolejna wiadomość klientki przy sygnale bez kroku na dziś: krok na teraz", async () => {
    await ingestMetaEvents([ev()]);
    db.openLead = { id: "LEAD1", clientId: "C-new", stage: "WYWIAD", firstContactAt: new Date(), lastContactAt: new Date(), nextActionAt: null, contactPhone: null, contactEmail: null };
    await ingestMetaEvents([ev({ text: "A ile kosztuje transport?" })]);
    expect(db.leadUpdates.at(-1)!.data).toMatchObject({ nextStepType: "INNE", stepSource: "AUTO_CHAT" });
    expect(createLead).toHaveBeenCalledTimes(1);
  });

  it("telefon podany później to twardy klucz: dopina sygnał do klientki z bazy", async () => {
    await ingestMetaEvents([ev()]);
    db.openLead = { id: "LEAD1", clientId: "C-stub", stage: "SYGNAL", firstContactAt: null, lastContactAt: null, nextActionAt: null, contactPhone: null, contactEmail: null };
    db.contact = { id: "CC1", clientId: "C-baza" };
    await ingestMetaEvents([ev({ text: "Mój numer 601 234 567" })]);
    const u = db.leadUpdates.find((x) => x.data.client)!;
    expect(u.data).toMatchObject({ contactPhone: "+48601234567", client: { connect: { id: "C-baza" } }, clientContact: { connect: { id: "CC1" } } });
    expect(db.threads[0].clientId).toBe("C-baza");
    expect(db.activities.some((a) => String(a.body).includes("Dopięto do klienta"))).toBe(true);
  });

  it("po zamknięciu poprzedniego sygnału nowa wiadomość zakłada nowy sygnał", async () => {
    await ingestMetaEvents([ev()]);
    db.openLead = null; // poprzedni sygnał zamknięty / zarchiwizowany
    await ingestMetaEvents([ev({ text: "Wracam z pytaniem" })]);
    expect(createLead).toHaveBeenCalledTimes(2);
  });

  it("Instagram: sygnał typu Instagram", async () => {
    await ingestMetaEvents([ev({ channel: "INSTAGRAM", userId: "IG9" })]);
    expect(createLead.mock.calls[0][0]).toMatchObject({ type: "INSTAGRAM" });
    expect(db.activities.some((a) => String(a.body).startsWith("Sygnał z Instagrama"))).toBe(true);
  });
});
