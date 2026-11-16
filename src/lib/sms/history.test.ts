import { beforeEach, describe, expect, it, vi } from "vitest";

// Wniosek 53: wyszukiwanie po całej historii SMS (kryteria odbioru): „18.12.2026”
// zwraca SMS potwierdzenia NK Medical Clinic, „kusnierz” zwraca wszystkie jej SMS-y,
// działa razem z filtrem klienta i dat oraz poza pierwszą stroną listy.

type Row = {
  id: string; sentAt: Date; recipient: string; status: string; errorMessage: string | null; body: string; userId: string | null; rentalId: string | null;
  user: { name: string } | null; client: { id: string; name: string } | null;
  rental: { id: string; title: string; device: { name: string }; client: { id: string; name: string } | null } | null;
};
const NK = { id: "c-nk", name: "NK MEDICAL CLINIC NATALIA KUŚNIERZ" };
const OTHER = { id: "c-x", name: "Salon Anna" };
const db = { rows: [] as Row[] };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: {
      findMany: vi.fn(async (args: { where?: { sentAt?: { gte?: Date; lt?: Date }; OR?: { clientId?: string; rental?: { clientId: string } }[] }; take?: number; select?: Record<string, unknown> }) => {
        const w = args.where ?? {};
        return [...db.rows].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()).filter((r) => {
          if (w.sentAt?.gte && r.sentAt < w.sentAt.gte) return false;
          if (w.sentAt?.lt && r.sentAt >= w.sentAt.lt) return false;
          if (w.OR) {
            const id = w.OR[0].clientId;
            if (!(r.client?.id === id || r.rental?.client?.id === id)) return false;
          }
          return true;
        });
      }),
    },
    messageTemplate: { findMany: vi.fn(async () => [{ label: "Potwierdzenie rezerwacji", body: "Potwierdzamy rezerwację: {rezerwacja_urzadzenie}, termin {rezerwacja_data_start}. Pytania: {telefon_obslugi}" }]) },
  },
}));

const { searchSmsHistory } = await import("./history");

let n = 0;
const sms = (over: Partial<Row>): Row => ({ id: `s${++n}`, sentAt: new Date(2026, 10, 1), recipient: "+48601234567", status: "SENT", errorMessage: null, body: "x", userId: null, rentalId: null, user: null, client: null, rental: null, ...over });

beforeEach(() => {
  n = 0;
  db.rows = [
    sms({ id: "nk1", sentAt: new Date(2026, 10, 16, 7, 37), client: NK, body: "Potwierdzamy rezerwację: Alma Harmony XL, termin 18.12.2026. Pytania: 531574115", rentalId: "r1", rental: { id: "r1", title: "NK", device: { name: "Alma 1" }, client: NK } }),
    sms({ id: "nk2", sentAt: new Date(2026, 8, 15), client: NK, body: "Potwierdzamy rezerwację: Alma Harmony XL głowica iPixel, terminy 9.10.2026, 13.11.2026" }),
    sms({ id: "nk3", sentAt: new Date(2026, 9, 2), client: NK, userId: "u1", user: { name: "Ania" }, body: "Dzień dobry, dowóz będzie 18.12 między 8 a 9." }),
    sms({ id: "x1", sentAt: new Date(2026, 10, 10), client: OTHER, body: "Przypominamy o wynajmie jutro" }),
    ...Array.from({ length: 150 }, (_, i) => sms({ id: `bulk${i}`, sentAt: new Date(2026, 0, 1, 0, i), body: `Wiadomość nr ${i}`, client: OTHER })),
  ];
});

describe("searchSmsHistory", () => {
  it("bez frazy: najnowsze pierwsze, z łączną liczbą i listą klientów", async () => {
    const r = await searchSmsHistory({ limit: 100 });
    expect(r.total).toBe(154);
    expect(r.items).toHaveLength(100);
    expect(r.clients.map((c) => c.name)).toEqual(["NK MEDICAL CLINIC NATALIA KUŚNIERZ", "Salon Anna"]);
  });

  it("„18.12.2026” zwraca SMS potwierdzenia NK, a nie inne daty", async () => {
    const r = await searchSmsHistory({ q: "18.12.2026" });
    expect(r.items.map((i) => i.id)).toEqual(["nk1"]);
  });

  it("„kusnierz” (bez ogonków) zwraca wszystkie SMS-y do NK Medical Clinic", async () => {
    const r = await searchSmsHistory({ q: "kusnierz" });
    expect(r.items.map((i) => i.id).sort()).toEqual(["nk1", "nk2", "nk3"]);
  });

  it("szuka w całej historii, także poza pierwszą stroną listy", async () => {
    const page1 = await searchSmsHistory({ limit: 100 });
    expect(page1.items.some((i) => i.id === "bulk0")).toBe(false); // najstarsze nie mieszczą się na stronie
    const r = await searchSmsHistory({ q: "nr 0" });
    expect(r.items.some((i) => i.id === "bulk0")).toBe(true);
  });

  it("filtr klienta i zakresu dat działa razem z frazą", async () => {
    expect((await searchSmsHistory({ q: "potwierdzamy", clientId: "c-nk" })).items.map((i) => i.id).sort()).toEqual(["nk1", "nk2"]);
    expect((await searchSmsHistory({ q: "potwierdzamy", clientId: "c-x" })).total).toBe(0);
    expect((await searchSmsHistory({ clientId: "c-nk", from: "2026-10-01", to: "2026-10-31" })).items.map((i) => i.id)).toEqual(["nk3"]);
    expect((await searchSmsHistory({ q: "potwierdzamy", from: "2026-11-16", to: "2026-11-16" })).items.map((i) => i.id)).toEqual(["nk1"]);
  });

  it("wyszukiwanie po numerze telefonu i stronicowanie", async () => {
    expect((await searchSmsHistory({ q: "601 234 567" })).total).toBe(154);
    const p2 = await searchSmsHistory({ limit: 100, offset: 100 });
    expect(p2.items).toHaveLength(54);
  });

  it("pole „źródło”: szablon (z nazwą) albo ręczny; autor lub automat; wynajem", async () => {
    const r = await searchSmsHistory({ q: "nk" });
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    expect(by.nk1).toMatchObject({ source: "szablon", template: "Potwierdzenie rezerwacji", author: null, rentalLabel: "NK (Alma 1)", clientName: NK.name });
    expect(by.nk2).toMatchObject({ source: "reczny" }); // inny format niż szablon (lista terminów)
    expect(by.nk3).toMatchObject({ source: "reczny", author: "Ania" });
  });
});
