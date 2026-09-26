import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { getInvoicePositionNames, listInvoicesForHistory, type FakturowniaHistoryInvoice } from "@/lib/integrations/fakturownia";
import { normalizeTitle } from "@/lib/history/normalize-title";
import { buildMatcher, type MatchCandidate, type MatchMethod, type MatchState } from "@/lib/history/match";
import { logWarn } from "@/lib/logger";

// Faktury z Fakturowni jako historia klienta (CRM, prompt 3B). Z Fakturowni
// wyłącznie odczyt; zapis tylko do client_invoices (i aliasów). Dashboard
// /finanse/faktury tej tabeli nie używa — dalej czyta Fakturownię na żywo.
// Idempotentny po fakturowniaInvoiceId; decyzje biura (matchedByUserId)
// nigdy nie są nadpisywane.

// Pozycje faktury nie przychodzą na liście — doczytywane pojedynczo, z
// limitem na jeden przebieg (limity API Fakturowni).
const MAX_DETAIL_FETCHES = 80;

type InvoiceClassification = {
  buyerKey: string;
  clientId: string | null;
  matchMethod: MatchMethod | null;
  matchState: MatchState;
  matchScore: number | null;
  candidates: MatchCandidate[];
};

function normalizeNip(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
}

async function loadInvoiceClassifier() {
  const [clients, aliases, linked] = await Promise.all([
    prisma.client.findMany({
      select: { id: true, name: true, city: true, nip: true, contacts: { select: { firstName: true, lastName: true, phone: true, email: true } } },
    }),
    prisma.clientAlias.findMany({ select: { alias: true, clientId: true } }),
    // Faktury wystawione z panelu → wynajem (i jego klient, jeśli przypięty).
    prisma.rentalFinance.findMany({
      where: { fakturowniaInvoiceId: { not: null } },
      select: { fakturowniaInvoiceId: true, rental: { select: { id: true, clientId: true } } },
    }),
  ]);
  const match = buildMatcher(clients, new Map(aliases.map((a) => [a.alias, a.clientId])), normalizePolishPhone);
  const rentalByInvoice = new Map(linked.map((l) => [l.fakturowniaInvoiceId as number, l.rental]));

  return function classify(inv: { fakturowniaInvoiceId: number; buyerName: string; buyerTaxNo: string | null }): InvoiceClassification & {
    rentalId: string | null;
  } {
    const buyerKey = normalizeTitle(inv.buyerName).key;
    const rental = rentalByInvoice.get(inv.fakturowniaInvoiceId) ?? null;
    if (rental?.clientId) {
      return { buyerKey, rentalId: rental.id, clientId: rental.clientId, matchMethod: "RENTAL", matchState: "AUTO", matchScore: 1, candidates: [] };
    }
    const r = match(buyerKey, { phones: [], emails: [], nips: inv.buyerTaxNo ? [inv.buyerTaxNo] : [] });
    return {
      buyerKey,
      rentalId: rental?.id ?? null,
      clientId: r.clientId,
      matchMethod: r.method,
      matchState: r.state,
      matchScore: r.score,
      candidates: r.candidates,
    };
  };
}

function matchData(c: InvoiceClassification & { rentalId: string | null }) {
  return {
    buyerKey: c.buyerKey,
    rentalId: c.rentalId,
    clientId: c.clientId,
    matchMethod: c.matchMethod,
    matchState: c.matchState,
    matchScore: c.matchScore,
    candidates: c.candidates.length ? (c.candidates as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  };
}

const day = (s: string) => new Date(`${s}T12:00:00.000Z`);

export type InvoiceHistoryPreview = {
  total: number;
  toImport: number;
  withNip: number;
  withRental: number;
  totalNet: number;
  perYear: Record<string, { count: number; net: number }>;
  byState: Record<MatchState, number>;
  unmatchedBuyers: { buyerName: string; count: number }[];
};

export async function previewInvoiceHistory(): Promise<InvoiceHistoryPreview> {
  const [invoices, existing, classify] = await Promise.all([
    listInvoicesForHistory(),
    prisma.clientInvoice.findMany({ select: { fakturowniaInvoiceId: true } }),
    loadInvoiceClassifier(),
  ]);
  const existingIds = new Set(existing.map((e) => e.fakturowniaInvoiceId));
  const perYear: InvoiceHistoryPreview["perYear"] = {};
  const byState: Record<MatchState, number> = { AUTO: 0, SUGGESTED: 0, CONFIRMED: 0, IGNORED: 0, UNMATCHED: 0 };
  const unmatched = new Map<string, number>();
  let withRental = 0;
  let totalNet = 0;

  for (const inv of invoices) {
    const net = Number(inv.priceNet) || 0;
    totalNet += net;
    const y = inv.sellDate.slice(0, 4);
    perYear[y] = { count: (perYear[y]?.count ?? 0) + 1, net: Math.round(((perYear[y]?.net ?? 0) + net) * 100) / 100 };
    const c = classify({ fakturowniaInvoiceId: inv.id, buyerName: inv.buyerName, buyerTaxNo: normalizeNip(inv.buyerTaxNo) });
    if (c.rentalId) withRental++;
    byState[c.matchState]++;
    if (c.matchState === "UNMATCHED" || c.matchState === "SUGGESTED") unmatched.set(inv.buyerName, (unmatched.get(inv.buyerName) ?? 0) + 1);
  }

  return {
    total: invoices.length,
    toImport: invoices.filter((i) => !existingIds.has(i.id)).length,
    withNip: invoices.filter((i) => normalizeNip(i.buyerTaxNo)).length,
    withRental,
    totalNet: Math.round(totalNet * 100) / 100,
    perYear,
    byState,
    unmatchedBuyers: [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([buyerName, count]) => ({ buyerName, count })),
  };
}

async function positionsFor(inv: FakturowniaHistoryInvoice, budget: { left: number }): Promise<string | null> {
  if (inv.positionNames) return inv.positionNames.join("; ") || null;
  if (budget.left <= 0) return null;
  budget.left--;
  try {
    return (await getInvoicePositionNames(inv.id)).join("; ") || null;
  } catch (err) {
    logWarn("history_invoice_positions_failed", { invoiceId: inv.id, message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function importInvoiceHistory(): Promise<{ created: number; updated: number; rematched: number }> {
  const [invoices, existing, classify] = await Promise.all([
    listInvoicesForHistory(),
    prisma.clientInvoice.findMany({
      select: {
        id: true,
        fakturowniaInvoiceId: true,
        number: true,
        buyerName: true,
        buyerTaxNo: true,
        totalNet: true,
        totalGross: true,
        sellDate: true,
        positionsSummary: true,
        paymentTo: true,
        paymentType: true,
      },
    }),
    loadInvoiceClassifier(),
  ]);
  const byId = new Map(existing.map((e) => [e.fakturowniaInvoiceId, e]));
  const budget = { left: MAX_DETAIL_FETCHES };
  let created = 0;
  let updated = 0;

  for (const inv of invoices) {
    const buyerTaxNo = normalizeNip(inv.buyerTaxNo);
    const base = {
      number: inv.number,
      issueDate: day(inv.issueDate),
      sellDate: day(inv.sellDate),
      buyerName: inv.buyerName.slice(0, 191),
      buyerTaxNo,
      totalNet: new Prisma.Decimal(inv.priceNet || "0"),
      totalGross: new Prisma.Decimal(inv.priceGross || "0"),
      paymentTo: inv.paymentTo ? day(inv.paymentTo) : null,
      paymentType: inv.paymentType,
    };
    const prev = byId.get(inv.id);
    if (!prev) {
      const positionsSummary = await positionsFor(inv, budget);
      await prisma.clientInvoice.create({
        data: { fakturowniaInvoiceId: inv.id, ...base, positionsSummary, ...matchData(classify({ fakturowniaInvoiceId: inv.id, buyerName: inv.buyerName, buyerTaxNo })) },
      });
      created++;
      continue;
    }
    // Korekta po stronie Fakturowni (numer, nabywca, kwoty) — odświeżamy dane,
    // dopasowanie przelicza rematchInvoices (z poszanowaniem decyzji biura).
    const changed =
      prev.number !== base.number ||
      prev.buyerName !== base.buyerName ||
      prev.buyerTaxNo !== base.buyerTaxNo ||
      !prev.totalNet.equals(base.totalNet) ||
      !prev.totalGross.equals(base.totalGross) ||
      prev.sellDate.getTime() !== base.sellDate.getTime() ||
      (prev.paymentTo?.getTime() ?? null) !== (base.paymentTo?.getTime() ?? null) ||
      prev.paymentType !== base.paymentType;
    const positionsSummary = prev.positionsSummary ?? (await positionsFor(inv, budget));
    if (changed || positionsSummary !== prev.positionsSummary) {
      await prisma.clientInvoice.update({ where: { id: prev.id }, data: { ...base, positionsSummary } });
      updated++;
    }
  }

  const rematched = await rematchInvoices();
  return { created, updated, rematched };
}

export async function rematchInvoices(): Promise<number> {
  const rows = await prisma.clientInvoice.findMany({
    where: { matchedByUserId: null },
    select: {
      id: true,
      fakturowniaInvoiceId: true,
      buyerName: true,
      buyerTaxNo: true,
      buyerKey: true,
      rentalId: true,
      clientId: true,
      matchMethod: true,
      matchState: true,
      matchScore: true,
      candidates: true,
    },
  });
  const classify = await loadInvoiceClassifier();
  let changed = 0;
  for (const r of rows) {
    const c = classify(r);
    const same =
      r.buyerKey === c.buyerKey &&
      r.rentalId === c.rentalId &&
      r.clientId === c.clientId &&
      r.matchMethod === c.matchMethod &&
      r.matchState === c.matchState &&
      r.matchScore === c.matchScore &&
      JSON.stringify(r.candidates ?? []) === JSON.stringify(c.candidates);
    if (same) continue;
    await prisma.clientInvoice.update({ where: { id: r.id }, data: matchData(c) });
    changed++;
  }
  return changed;
}

// Decyzje biura dla faktur (zakładka „Faktury” na /klienci/dopasowania).
// Przypisanie uczy alias z nazwy nabywcy i — gdy klient nie ma jeszcze NIP,
// a faktura go ma — zwraca propozycję wpisania NIP (prompt 3, sekcja 3).
export type InvoiceDecision =
  | { action: "assign"; ids: string[]; clientId: string }
  | { action: "ignore"; ids: string[] }
  | { action: "reset"; ids: string[] };

export function parseInvoiceDecision(body: unknown): InvoiceDecision | string {
  if (!body || typeof body !== "object") return "Nieprawidłowe dane.";
  const b = body as Record<string, unknown>;
  const ids = Array.isArray(b.ids) ? b.ids.filter((k): k is string => typeof k === "string" && k.length > 0) : [];
  if (ids.length === 0 || ids.length > 500) return "Wybierz co najmniej jedną fakturę.";
  if (b.action === "assign") {
    if (typeof b.clientId !== "string" || !b.clientId) return "Wybierz klienta.";
    return { action: "assign", ids, clientId: b.clientId };
  }
  if (b.action === "ignore" || b.action === "reset") return { action: b.action, ids };
  return "Nieznana akcja.";
}

export async function applyInvoiceDecision(
  d: InvoiceDecision,
  userId: string,
): Promise<{ invoices: number; nipSuggestion: { clientId: string; clientName: string; nip: string } | null }> {
  if (d.action === "assign") {
    const client = await prisma.client.findUnique({ where: { id: d.clientId }, select: { id: true, name: true, nip: true } });
    if (!client) throw new Error("Klient nie istnieje.");
    const rows = await prisma.clientInvoice.findMany({ where: { id: { in: d.ids } }, select: { buyerKey: true, buyerTaxNo: true } });
    const res = await prisma.$transaction(async (tx) => {
      for (const alias of new Set(rows.map((r) => r.buyerKey).filter(Boolean))) {
        await tx.clientAlias.upsert({
          where: { alias },
          create: { alias, clientId: d.clientId, createdByUserId: userId },
          update: { clientId: d.clientId, createdByUserId: userId },
        });
      }
      return tx.clientInvoice.updateMany({
        where: { id: { in: d.ids } },
        data: { clientId: d.clientId, matchState: "CONFIRMED", matchMethod: "MANUAL", matchScore: 1, matchedByUserId: userId, candidates: Prisma.DbNull },
      });
    });
    const nips = [...new Set(rows.map((r) => r.buyerTaxNo).filter((n): n is string => Boolean(n)))];
    const nipSuggestion = !client.nip && nips.length === 1 ? { clientId: client.id, clientName: client.name, nip: nips[0] } : null;
    return { invoices: res.count, nipSuggestion };
  }

  if (d.action === "ignore") {
    const res = await prisma.clientInvoice.updateMany({
      where: { id: { in: d.ids } },
      data: { clientId: null, matchState: "IGNORED", matchMethod: null, matchScore: null, matchedByUserId: userId },
    });
    return { invoices: res.count, nipSuggestion: null };
  }

  // Cofnięcie: alias z nazwy nabywcy znika, faktury wracają do dopasowania automatycznego.
  const keys = (await prisma.clientInvoice.findMany({ where: { id: { in: d.ids } }, select: { buyerKey: true } })).map((r) => r.buyerKey);
  const res = await prisma.$transaction(async (tx) => {
    await tx.clientAlias.deleteMany({ where: { alias: { in: keys.filter(Boolean) } } });
    return tx.clientInvoice.updateMany({ where: { id: { in: d.ids } }, data: { matchedByUserId: null } });
  });
  await rematchInvoices();
  return { invoices: res.count, nipSuggestion: null };
}
