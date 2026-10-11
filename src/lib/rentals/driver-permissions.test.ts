import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

// Wniosek 31 (zakres minimalny): konto KIEROWCA nie ma dostępu do funkcji biura i
// nie widzi pól finansowych w GET /api/rentals; rozliczenie po potwierdzeniu /
// fakturze jest zablokowane dla kierowcy, a zapis uwagi bez rozliczenia nie
// tworzy RentalFinance. ADMIN, STAFF i AGENT działają jak dotąd.

type Role = "ADMIN" | "STAFF" | "AGENT" | "KIEROWCA";
let role: Role | null = "KIEROWCA";
const session = () => (role ? { user: { id: role === "KIEROWCA" ? "drv1" : "u1", role, name: "T", email: "t@x.pl" } } : null);

// Atrapa bazy: każde nieopisane zapytanie zwraca null / [], opisane poniżej.
const fx = {
  rentals: [] as unknown[],
  rental: null as unknown,
  upsert: vi.fn(async () => ({})),
};
vi.mock("@/auth", () => ({ auth: vi.fn(async () => session()) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const model = (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, { get: (t, k: string) => (k in t ? t[k] : vi.fn(async () => null)) });
  const prisma = new Proxy(
    {
      rental: model({
        findMany: vi.fn(async () => fx.rentals),
        findUnique: vi.fn(async () => fx.rental),
        findUniqueOrThrow: vi.fn(async () => fx.rental),
      }),
      rentalFinance: model({ upsert: (...a: unknown[]) => (fx.upsert as (...x: unknown[]) => unknown)(...a) }),
    } as Record<string, unknown>,
    { get: (t, k: string) => (k in t ? t[k] : model()) },
  );
  return { prisma };
});
vi.mock("@/lib/clients/terms", () => ({ termsWarnings: vi.fn(async () => new Map()) }));
vi.mock("@/lib/integrations/hubspot", () => ({ searchHubspotContacts: vi.fn(async () => []) }));
vi.mock("@/lib/rental-vehicle", () => ({ resolveVehicleId: vi.fn(async (v: unknown) => ({ ok: true, vehicleId: v ?? null })) }));
vi.mock("@/lib/finance", () => ({
  loadPricingSettings: vi.fn(async () => ({ capFeeHsNet: new Prisma.Decimal(50), membraneFeeCooltechNet: new Prisma.Decimal(30), vatRateDefault: new Prisma.Decimal(23) })),
  loadPricingContext: vi.fn(async () => ({ pricingCategory: null, deviceVariant: null, durationDays: 1, priceRules: [] })),
  parseTransportPrice: vi.fn(() => null),
}));
vi.mock("@/lib/pricing", () => ({
  PricingError: class extends Error {},
  resolveBasePrice: vi.fn(() => ({ priceNet: new Prisma.Decimal(999), source: "PRICE_LIST" })),
  recalculateFinance: vi.fn(() => ({
    baseRentalPriceNet: new Prisma.Decimal(100),
    baseRentalPriceSource: "PRICE_LIST",
    pulseCalculationStatus: null,
    pulseSurchargeNet: null,
    totalNet: new Prisma.Decimal(100),
    totalGross: new Prisma.Decimal(123),
    transportTotalNet: null,
    transportTotalGross: null,
  })),
}));

const rentals = await import("@/app/api/rentals/route");
const driverFinance = await import("@/app/api/rentals/[id]/finance/driver/route");
const hubspot = await import("@/app/api/integrations/hubspot/contacts/search/route");
const tplList = await import("@/app/api/message-templates/route");
const tplOne = await import("@/app/api/message-templates/[id]/route");
const remSettings = await import("@/app/api/reminders/settings/route");
const remLogs = await import("@/app/api/reminders/check-logs/route");
const remQueue = await import("@/app/api/reminders/queue/[id]/route");
const remCancel = await import("@/app/api/reminders/queue/[id]/cancel/route");
const devSync = await import("@/app/api/devices/[id]/sync/route");
const devSyncAll = await import("@/app/api/devices/sync-all/route");
const { toDriverRental, cashToCollect } = await import("./driver-dto");
const { rentalNeedsReport } = await import("@/lib/report-alerts");
const { rentalInvoiceStatus } = await import("@/lib/invoice-alerts");

const req = (method: string, body?: unknown, url = "http://localhost/api/x") =>
  new NextRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });
const ctx = { params: Promise.resolve({ id: "r1" }) };

// Wynik handlera albo „przeszedł strażnika, ale poległ na atrapie” (undefined).
async function status(call: () => Promise<Response>): Promise<number | undefined> {
  try {
    return (await call()).status;
  } catch {
    return undefined;
  }
}

beforeEach(() => {
  role = "KIEROWCA";
  fx.rentals = [];
  fx.rental = null;
  fx.upsert.mockClear();
});

describe("endpointy biura: KIEROWCA dostaje 403", () => {
  const staffOnly: [string, () => Promise<Response>][] = [
    ["POST /message-templates", () => tplList.POST(req("POST", {}))],
    ["PATCH /message-templates/[id]", () => tplOne.PATCH(req("PATCH", {}), ctx)],
    ["DELETE /message-templates/[id]", () => tplOne.DELETE(req("DELETE"), ctx)],
    ["POST /reminders/settings", () => remSettings.POST(req("POST", {}))],
    ["PATCH /reminders/queue/[id]", () => remQueue.PATCH(req("PATCH", {}), ctx)],
    ["POST /reminders/queue/[id]/cancel", () => remCancel.POST(req("POST", {}), ctx)],
    ["POST /devices/[id]/sync", () => devSync.POST(req("POST"), ctx)],
    ["POST /devices/sync-all", () => devSyncAll.POST()],
  ];
  const officeRead: [string, () => Promise<Response>][] = [
    ["GET /integrations/hubspot/contacts/search", () => hubspot.GET(req("GET", undefined, "http://localhost/api/x?q=ab"))],
    ["GET /reminders/check-logs", () => remLogs.GET(req("GET"))],
  ];

  for (const [name, call] of [...staffOnly, ...officeRead]) {
    it(`${name}: KIEROWCA → 403`, async () => {
      role = "KIEROWCA";
      expect(await status(call)).toBe(403);
    });
    it(`${name}: brak sesji → 403`, async () => {
      role = null;
      expect(await status(call)).toBe(403);
    });
    it(`${name}: ADMIN i STAFF przechodzą strażnika`, async () => {
      for (const r of ["ADMIN", "STAFF"] as const) {
        role = r;
        expect(await status(call)).not.toBe(403);
      }
    });
  }
  for (const [name, call] of staffOnly) {
    it(`${name}: AGENT dalej 403`, async () => {
      role = "AGENT";
      expect(await status(call)).toBe(403);
    });
  }
  for (const [name, call] of officeRead) {
    it(`${name}: AGENT dalej ma dostęp (odczyt)`, async () => {
      role = "AGENT";
      expect(await status(call)).not.toBe(403);
    });
  }
});

// --- GET /api/rentals ---

const money = (n: number) => new Prisma.Decimal(n);
const finance = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  rentalId: "r1",
  baseRentalPriceNet: money(400),
  baseRentalPriceSource: "PRICE_LIST",
  deviceVariant: "single_flex",
  pulseCounterStart: 100,
  pulseCounterEnd: 200,
  pulseCalculationStatus: "OK",
  pulseSurchargeNet: null,
  capUsedHS: null,
  capCountHS: 1,
  membraneUsed: null,
  membraneCount: 1,
  vatApplicable: true,
  vatRate: money(23),
  invoiceNet: money(400),
  totalNet: money(400),
  totalGross: money(492),
  paymentMethod: "CASH",
  transportPriceNet: money(80),
  transportPaidSeparately: true,
  transportVatApplicable: false,
  transportPaymentMethod: "CASH",
  transportCashCollected: null,
  transportTotalNet: money(80),
  transportTotalGross: money(98.4),
  deliveryDurationMinutes: null,
  pickupDurationMinutes: null,
  pickupVehicleId: null,
  deliveryNotes: "dzwonić do bramy",
  pickupNotes: null,
  confirmedAt: null,
  fakturowniaInvoiceId: null,
  fakturowniaInvoiceNumber: "FV 7/10/2026",
  invoiceIssuedAt: null,
  invoiceError: null,
  ...over,
});
const rentalRow = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  deviceId: "dev1",
  device: { id: "dev1", name: "LightSheer", shortName: "LS", color: "#123456", active: true, pricingCategory: "LIGHTSHEER_FLEX", variantOptions: ["single_flex"], googleCalendarId: "cal@group.calendar.google.com", createdAt: new Date() },
  googleEventId: "ev1",
  googleCalendarId: "cal@group.calendar.google.com",
  title: "Salon Anna",
  description: "tel. 600 100 200, anna@salon.pl NIP 5260001246",
  startsAt: new Date("2026-10-20T08:00:00Z"),
  endsAt: new Date("2026-10-22T08:00:00Z"),
  allDay: false,
  eventType: "WYNAJEM",
  clientId: "c1",
  hubspotContactId: "h1",
  driverId: "drv1",
  driver: { id: "drv1", name: "Mateusz", driverColor: "#ff0000" },
  vehicleId: "v1",
  vehicle: { id: "v1", name: "Dacia" },
  contactNameCache: "Anna K.",
  contactPhoneCache: "+48600100200",
  contactEmailCache: "anna@salon.pl",
  contactNipCache: "5260001246",
  contactCompanyCache: "Salon Anna",
  contactAddressCache: "Długa 1, Kraków",
  contactTransportPriceCache: "80",
  deliveryAddress: "Długa 1, Kraków",
  deliveryTime: "10:00",
  pickupTime: "16:00",
  transportPrice: "80",
  internalNotes: "brama od podwórka",
  trainingPlace: null,
  trainingLead: null,
  trainingParticipants: null,
  finance: finance(),
  messages: [{ id: "m1", body: "Przypomnienie: wynajem w piątek" }],
  reminderRules: [{ id: "rr1", daysBefore: 3 }],
  ...over,
});

describe("GET /api/rentals", () => {
  const get = () => rentals.GET(req("GET", undefined, "http://localhost/api/rentals?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z"));

  it("KIEROWCA: bez cen, faktur, transportu, SMS, e-maila i NIP; z danymi do pracy", async () => {
    fx.rentals = [rentalRow()];
    const res = await get();
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    for (const forbidden of ["anna@salon.pl", "5260001246", "invoiceNet", "FV 7/10/2026", "fakturowniaInvoiceNumber", "invoiceIssuedAt", "invoiceError", "transportPrice", "transportPriceNet", "baseRentalPriceNet", "totalNet", "totalGross", "messages", "Przypomnienie", "reminderRules", "googleCalendarId", "contactEmailCache", "contactNipCache", "description"]) {
      expect(text).not.toContain(forbidden);
    }
    const body = JSON.parse(text).rentals[0];
    expect(body).toMatchObject({
      id: "r1",
      title: "Salon Anna",
      contactNameCache: "Anna K.",
      contactPhoneCache: "+48600100200",
      contactCompanyCache: "Salon Anna",
      deliveryAddress: "Długa 1, Kraków",
      deliveryTime: "10:00",
      pickupTime: "16:00",
      internalNotes: "brama od podwórka",
      driver: { name: "Mateusz", driverColor: "#ff0000" },
      device: { name: "LightSheer", color: "#123456" },
    });
    expect(body.finance).toMatchObject({ deviceVariant: "single_flex", paymentMethod: "CASH", deliveryNotes: "dzwonić do bramy", pulseCounterStart: 100, pulseCounterEnd: 200 });
  });

  it("KIEROWCA: gotówka do odebrania = wynajem brutto (VAT) + transport netto (bez VAT) gotówką", async () => {
    fx.rentals = [rentalRow()];
    const body = await (await get()).json();
    expect(body.rentals[0].finance.cashToCollect).toBe(572);
  });

  it("KIEROWCA: tylko własne wynajmy (filtr driverId) i bez pobierania SMS", async () => {
    fx.rentals = [rentalRow()];
    await get();
    const { prisma } = await import("@/lib/prisma");
    const call = (prisma.rental.findMany as unknown as { mock: { calls: [{ where: { driverId?: string }; include: Record<string, unknown> }][] } }).mock.calls.at(-1)![0];
    expect(call.where.driverId).toBe("drv1");
    expect(call.include).not.toHaveProperty("messages");
    expect(call.include).not.toHaveProperty("reminderRules");
  });

  for (const r of ["ADMIN", "STAFF", "AGENT"] as const) {
    it(`${r}: odpowiedź jak dotąd (ceny, faktury, SMS, e-mail, NIP)`, async () => {
      role = r;
      fx.rentals = [rentalRow()];
      const res = await get();
      expect(res.status).toBe(200);
      const text = JSON.stringify(await res.json());
      for (const present of ["anna@salon.pl", "5260001246", "invoiceNet", "FV 7/10/2026", "transportPrice", "messages", "reminderRules", "totalGross"]) {
        expect(text).toContain(present);
      }
    });
  }
});

describe("driver-dto", () => {
  it("cashToCollect: przelew bez gotówki, brak rozliczenia = null, szkolenie bez transportu", () => {
    expect(cashToCollect(null, "WYNAJEM")).toBeNull();
    expect(cashToCollect(finance({ paymentMethod: "TRANSFER", transportPaymentMethod: "TRANSFER" }) as never, "WYNAJEM")).toBe(0);
    expect(cashToCollect(finance({ paymentMethod: "CASH", transportPaidSeparately: false }) as never, "WYNAJEM")).toBe(492);
    expect(cashToCollect(finance() as never, "SZKOLENIE")).toBe(492);
    expect(cashToCollect(finance({ vatApplicable: false }) as never, "WYNAJEM")).toBe(480);
  });
  it("kafelki kalendarza: ikony „brak raportu” i „faktura” te same dla pełnego i zawężonego wiersza", () => {
    const past = { startsAt: new Date("2026-09-20T08:00:00Z"), endsAt: new Date("2026-09-22T08:00:00Z") };
    const cases = [
      rentalRow({ ...past, finance: finance() }),
      rentalRow({ ...past, finance: finance({ confirmedAt: new Date("2026-09-22T12:00:00Z"), fakturowniaInvoiceId: 77 }) }),
      rentalRow({ ...past, finance: finance({ vatApplicable: false }) }),
      rentalRow({ ...past, finance: null }),
    ];
    for (const row of cases) {
      const full = JSON.parse(JSON.stringify(row));
      const slim = JSON.parse(JSON.stringify(toDriverRental(row as never)));
      expect(rentalNeedsReport(slim)).toBe(rentalNeedsReport(full));
      expect(rentalInvoiceStatus(slim)).toBe(rentalInvoiceStatus(full));
    }
  });
  it("toDriverRental nie przepuszcza nieznanych pól (whitelist)", () => {
    const out = toDriverRental({ ...rentalRow(), noweTajnePole: "x" } as never);
    expect(Object.keys(out)).not.toContain("noweTajnePole");
  });
});

// --- PATCH /api/rentals/[id]/finance/driver ---

const patchDriver = (body: unknown) => driverFinance.PATCH(req("PATCH", body), ctx);

describe("rozliczenie kierowcy: blokada po potwierdzeniu / fakturze", () => {
  it("KIEROWCA bez rozliczenia: 409 i nie powstaje RentalFinance (ani gotówka)", async () => {
    fx.rental = rentalRow({ finance: null });
    const res = await patchDriver({ deliveryNotes: "tylko uwaga" });
    expect(res.status).toBe(409);
    expect(fx.upsert).not.toHaveBeenCalled();
  });

  it("KIEROWCA po potwierdzeniu, ale BEZ faktury: może poprawić liczniki i cofnąć potwierdzenie", async () => {
    fx.rental = rentalRow({ finance: finance({ confirmedAt: new Date() }) });
    expect((await patchDriver({ pulseCounterEnd: 250 })).status).toBe(200);
    expect((await patchDriver({ confirmed: false })).status).toBe(200);
    expect(fx.upsert).toHaveBeenCalledTimes(2);
  });

  it("KIEROWCA po fakturze: zmiana licznika, nakładek, membran i cofnięcie potwierdzenia → 409", async () => {
    fx.rental = rentalRow({ finance: finance({ confirmedAt: new Date(), capUsedHS: true, capCountHS: 1, fakturowniaInvoiceId: 123, invoiceIssuedAt: new Date() }) });
    expect((await patchDriver({ pulseCounterEnd: 250 })).status).toBe(409);
    expect((await patchDriver({ capUsedHS: true, capCountHS: 2 })).status).toBe(409);
    expect((await patchDriver({ membraneUsed: true, membraneCount: 1 })).status).toBe(409);
    expect((await patchDriver({ confirmed: false })).status).toBe(409);
    expect(fx.upsert).not.toHaveBeenCalled();
  });

  it("KIEROWCA po fakturze: autozapis tych samych liczników, uwagi i potwierdzenie przechodzą", async () => {
    fx.rental = rentalRow({ finance: finance({ confirmedAt: new Date(), fakturowniaInvoiceId: 123 }) });
    const res = await patchDriver({ pulseCounterStart: 100, pulseCounterEnd: 200, deliveryNotes: "nowa uwaga", confirmed: true });
    expect(res.status).toBe(200);
    expect(fx.upsert).toHaveBeenCalledTimes(1);
  });

  it("KIEROWCA przed potwierdzeniem: zmiana licznika działa jak dotąd", async () => {
    fx.rental = rentalRow({ finance: finance() });
    expect((await patchDriver({ pulseCounterEnd: 260 })).status).toBe(200);
    expect(fx.upsert).toHaveBeenCalledTimes(1);
  });

  it("KIEROWCA: cudzy wynajem → 403", async () => {
    fx.rental = rentalRow({ driverId: "inny" });
    expect((await patchDriver({ deliveryNotes: "x" })).status).toBe(403);
  });

  for (const r of ["ADMIN", "STAFF"] as const) {
    it(`${r}: może zmienić liczniki i cofnąć potwierdzenie po fakturze`, async () => {
      role = r;
      fx.rental = rentalRow({ finance: finance({ confirmedAt: new Date(), fakturowniaInvoiceId: 5 }) });
      expect((await patchDriver({ pulseCounterEnd: 300 })).status).toBe(200);
      expect((await patchDriver({ confirmed: false })).status).toBe(200);
      expect(fx.upsert).toHaveBeenCalledTimes(2);
    });
    it(`${r}: bez rozliczenia zapis działa jak dotąd (tworzy rekord)`, async () => {
      role = r;
      fx.rental = rentalRow({ finance: null });
      expect((await patchDriver({ deliveryNotes: "biuro" })).status).toBe(200);
      expect(fx.upsert).toHaveBeenCalledTimes(1);
    });
  }

  it("AGENT: 403 (jak dotąd)", async () => {
    role = "AGENT";
    fx.rental = rentalRow();
    expect((await patchDriver({ deliveryNotes: "x" })).status).toBe(403);
  });
});
