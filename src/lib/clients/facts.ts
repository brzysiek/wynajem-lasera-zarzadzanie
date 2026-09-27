import type { Prisma } from "@prisma/client";
import { CATEGORY_TO_INTEREST, DEVICE_INTEREST_KEYS, type DeviceInterestKey } from "@/lib/clients/labels";
import type { ClientInvoiceFact, ClientRentalFact } from "@/lib/clients/summary";
import { interestsFromText } from "@/lib/history/invoices";

// Fakty z wynajmów, historii kalendarzy i faktur — wspólne dla karty
// (load.ts) i listy klientów (list-load.ts).

export const RENTAL_FACT_SELECT = {
  startsAt: true,
  endsAt: true,
  eventType: true,
  deletedInGoogle: true,
  device: { select: { pricingCategory: true } },
  finance: { select: { confirmedAt: true, totalNet: true } },
} as const;

export type RentalFactRow = {
  startsAt: Date;
  endsAt: Date;
  eventType: "WYNAJEM" | "SZKOLENIE";
  deletedInGoogle: boolean;
  device: { pricingCategory: string | null };
  finance: { confirmedAt: Date | null; totalNet: { toString(): string } } | null;
};

export function toFact(r: RentalFactRow): ClientRentalFact {
  return {
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    eventType: r.eventType,
    deletedInGoogle: r.deletedInGoogle,
    confirmedAt: r.finance?.confirmedAt ?? null,
    totalNet: r.finance ? Number(r.finance.totalNet.toString()) : null,
    interest: r.device.pricingCategory ? (CATEGORY_TO_INTEREST[r.device.pricingCategory] ?? null) : null,
  };
}

// Historia z kalendarzy (prompt 3A): liczą się tylko wpisy przypisane
// automatycznie albo potwierdzone — propozycje (SUGGESTED) dopiero po
// potwierdzeniu. Bez kwot: nie wpływają na przychód.
export const HISTORY_FACT_WHERE: Prisma.RentalHistoryWhereInput = {
  matchState: { in: ["AUTO", "CONFIRMED"] },
  kind: { in: ["WYNAJEM", "SZKOLENIE"] },
};
export const HISTORY_FACT_SELECT = {
  startsAt: true,
  endsAt: true,
  kind: true,
  device: { select: { pricingCategory: true } },
} as const;

export type HistoryFactRow = { startsAt: Date; endsAt: Date; kind: string; device: { pricingCategory: string | null } };

export function historyToFact(h: HistoryFactRow): ClientRentalFact {
  return {
    startsAt: h.startsAt,
    endsAt: h.endsAt,
    eventType: h.kind === "SZKOLENIE" ? "SZKOLENIE" : "WYNAJEM",
    deletedInGoogle: false,
    confirmedAt: null,
    totalNet: null,
    interest: h.device.pricingCategory ? (CATEGORY_TO_INTEREST[h.device.pricingCategory] ?? null) : null,
    historical: true,
  };
}

// Faktury przypisane do klienta (prompt 3B) — dowód wynajmu, gdy nie ma go
// w kalendarzu (summary.ts), i suma „zafakturowano”.
export const INVOICE_FACT_WHERE: Prisma.ClientInvoiceWhereInput = { matchState: { in: ["AUTO", "CONFIRMED"] } };
export const INVOICE_FACT_SELECT = { sellDate: true, totalNet: true, rentalId: true, positionsSummary: true } as const;

export function invoiceToFact(i: { sellDate: Date; totalNet: { toString(): string }; rentalId: string | null; positionsSummary: string | null }): ClientInvoiceFact {
  return {
    sellDate: i.sellDate,
    totalNet: Number(i.totalNet.toString()),
    hasRental: i.rentalId != null,
    interest: interestsFromText(i.positionsSummary).find((k) => k !== "SZKOLENIE") ?? null,
  };
}

export function parseInterests(v: unknown): DeviceInterestKey[] {
  return Array.isArray(v) ? v.filter((x): x is DeviceInterestKey => DEVICE_INTEREST_KEYS.includes(x as DeviceInterestKey)) : [];
}

export function personName(c: { firstName: string | null; lastName: string | null }): string | null {
  const n = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return n || null;
}
