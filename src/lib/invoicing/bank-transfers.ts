import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BankTransaction } from "@/lib/invoicing/bank-statement-parse";
import type { InvoiceMatch } from "@/lib/invoicing/bank-match";
import { invoicePaymentStatus, paymentCoverage, paymentLabel, type PaymentCoverage } from "@/lib/clients/payment-status";
import { BANK_STATEMENT_SINCE } from "@/lib/invoicing/bank-since";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges, type ChangeActor } from "@/lib/changelog/record";

// Przelewy przychodzące z wgranych wyciągów CSV (wniosek 6): zapis przy
// wgraniu, okres sprawdzony przez wyciągi („wpłaty aktualne na”), odczyt
// dla agenta (MCP `platnosci`) i ręczne dopasowanie przelewu do faktury
// (propozycja agenta zaakceptowana przez ADMIN).

const day = (s: string) => new Date(`${s}T12:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Klucz przelewu: data | kwota | opis | który z identycznych w pliku — ten
// sam przelew z nakładającego się wyciągu dostaje ten sam klucz.
export function transferHashes(transactions: BankTransaction[]): Map<BankTransaction, string> {
  const seen = new Map<string, number>();
  const out = new Map<BankTransaction, string>();
  for (const t of transactions) {
    const base = `${t.date}|${t.amount.toFixed(2)}|${t.description}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(t, createHash("sha256").update(`${base}|${n}`).digest("hex"));
  }
  return out;
}

export function statementPeriod(transactions: BankTransaction[]): { periodFrom: Date | null; periodTo: Date | null } {
  const dates = transactions.map((t) => t.date).sort();
  return { periodFrom: dates.length ? day(dates[0]) : null, periodTo: dates.length ? day(dates[dates.length - 1]) : null };
}

// Zapis przelewów przychodzących + oznaczenie niejednoznacznych. Zwraca
// id przelewu po kluczu (do powiązania wpłaty z przelewem).
export async function storeIncomingTransfers(transactions: BankTransaction[], matches: InvoiceMatch[]) {
  const incoming = transactions.filter((t) => t.amount > 0);
  const hashes = transferHashes(incoming);
  if (incoming.length) {
    await prisma.bankTransfer.createMany({
      data: incoming.map((t) => ({ bookedAt: day(t.date), amount: new Prisma.Decimal(t.amount.toFixed(2)), description: t.description, hash: hashes.get(t)! })),
      skipDuplicates: true,
    });
  }
  const rows = incoming.length ? await prisma.bankTransfer.findMany({ where: { hash: { in: [...hashes.values()] } }, select: { id: true, hash: true } }) : [];
  const idByHash = new Map(rows.map((r) => [r.hash, r.id]));

  const ambiguous = new Map<string, number[]>();
  for (const m of matches) {
    if (m.candidates.length < 2) continue;
    for (const t of m.candidates) {
      const h = hashes.get(t);
      if (h) ambiguous.set(h, [...(ambiguous.get(h) ?? []), m.invoiceId]);
    }
  }
  for (const [hash, ids] of ambiguous) {
    await prisma.bankTransfer.updateMany({ where: { hash, matchState: { in: ["NONE", "AMBIGUOUS"] } }, data: { matchState: "AMBIGUOUS", candidates: ids } });
  }
  return {
    hashes,
    transferId: (t: BankTransaction) => {
      const h = hashes.get(t);
      return h ? (idByHash.get(h) ?? null) : null;
    },
  };
}

export async function markTransfersMatched(pairs: { transferId: string; fakturowniaInvoiceId: number }[]) {
  const now = new Date();
  for (const p of pairs) {
    await prisma.bankTransfer.updateMany({
      where: { id: p.transferId, matchState: { in: ["NONE", "AMBIGUOUS"] } },
      data: { fakturowniaInvoiceId: p.fakturowniaInvoiceId, matchState: "AUTO", matchedAt: now, candidates: Prisma.DbNull },
    });
  }
}

export async function loadPaymentCoverage(): Promise<PaymentCoverage> {
  const uploads = await prisma.bankStatementUpload.findMany({ select: { periodFrom: true, periodTo: true, uploadedAt: true } });
  return paymentCoverage(uploads);
}

// --- ręczne dopasowanie (propozycja agenta → akceptacja ADMIN) ---

export type PaymentMatchInput = { transferId: string; fakturowniaInvoiceId: number };

export async function describePaymentMatch(input: PaymentMatchInput) {
  const [transfer, invoice] = await Promise.all([
    prisma.bankTransfer.findUnique({ where: { id: input.transferId } }),
    prisma.clientInvoice.findUnique({ where: { fakturowniaInvoiceId: input.fakturowniaInvoiceId }, select: { number: true, buyerName: true, totalGross: true, clientId: true } }),
  ]);
  return { transfer, invoice };
}

export async function applyPaymentMatch(input: PaymentMatchInput, actor: ChangeActor): Promise<{ ok: true } | { ok: false; message: string }> {
  const { transfer, invoice } = await describePaymentMatch(input);
  if (!transfer) return { ok: false, message: "Przelew nie istnieje." };
  if (!invoice) return { ok: false, message: "Faktura nie istnieje w panelu." };
  if (transfer.matchState === "AUTO" || transfer.matchState === "MANUAL") {
    if (transfer.fakturowniaInvoiceId === input.fakturowniaInvoiceId) return { ok: false, message: "Ten przelew jest już dopasowany do tej faktury." };
    return { ok: false, message: "Ten przelew jest już dopasowany do innej faktury." };
  }
  const paid = await prisma.fakturowniaPayment.findUnique({ where: { fakturowniaInvoiceId: input.fakturowniaInvoiceId } });
  if (paid) return { ok: false, message: "Faktura jest już oznaczona jako zapłacona." };
  await prisma.$transaction(async (tx) => {
    await tx.fakturowniaPayment.create({ data: { fakturowniaInvoiceId: input.fakturowniaInvoiceId, paidAt: transfer.bookedAt, bankTransferId: transfer.id } });
    await tx.bankTransfer.update({
      where: { id: transfer.id },
      data: { fakturowniaInvoiceId: input.fakturowniaInvoiceId, matchState: "MANUAL", matchedByUserId: actor.approvedById ?? actor.userId, matchedAt: new Date(), candidates: Prisma.DbNull },
    });
    await recordChanges(tx, actor, [
      {
        entity: "INVOICE",
        entityId: String(input.fakturowniaInvoiceId),
        clientId: invoice.clientId,
        operation: "PAYMENT_MATCH",
        before: toLogValue({ faktura: invoice.number, zaplacona: false }),
        after: toLogValue({ faktura: invoice.number, przelew: { data: ymd(transfer.bookedAt), kwota: transfer.amount.toString(), opis: transfer.description.slice(0, 120) } }),
      },
    ]);
  });
  return { ok: true };
}

// --- odczyt dla agenta (MCP `platnosci`) ---

export type PaymentsQuery = { from: Date | null; to: Date | null; state: string | null; clientId: string | null; skip: number; take: number };

const STATE_LABEL: Record<string, string> = { AUTO: "dopasowany automatycznie", MANUAL: "dopasowany ręcznie", AMBIGUOUS: "niejednoznaczny", NONE: "niedopasowany" };

export async function listPaymentsForAgent(q: PaymentsQuery) {
  const [lastUpload, coverage] = await Promise.all([prisma.bankStatementUpload.findFirst({ orderBy: { uploadedAt: "desc" } }), loadPaymentCoverage()]);

  const clientInvoiceIds = q.clientId
    ? (await prisma.clientInvoice.findMany({ where: { clientId: q.clientId }, select: { fakturowniaInvoiceId: true } })).map((i) => i.fakturowniaInvoiceId)
    : null;
  const states = q.state === "niedopasowane" ? ["NONE", "AMBIGUOUS"] : q.state === "dopasowane" ? ["AUTO", "MANUAL"] : q.state ? [q.state] : null;
  const where: Prisma.BankTransferWhereInput = {
    ...(q.from || q.to ? { bookedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    ...(states ? { matchState: { in: states } } : {}),
    ...(clientInvoiceIds ? { fakturowniaInvoiceId: { in: clientInvoiceIds } } : {}),
  };
  const [total, transfers] = await Promise.all([
    prisma.bankTransfer.count({ where }),
    prisma.bankTransfer.findMany({ where, orderBy: { bookedAt: "desc" }, skip: q.skip, take: q.take }),
  ]);
  const invoiceIds = [
    ...new Set(transfers.flatMap((t) => [t.fakturowniaInvoiceId, ...(Array.isArray(t.candidates) ? (t.candidates as number[]) : [])]).filter((x): x is number => typeof x === "number")),
  ];
  const invoices = invoiceIds.length
    ? await prisma.clientInvoice.findMany({ where: { fakturowniaInvoiceId: { in: invoiceIds } }, include: { client: { select: { id: true, name: true } } } })
    : [];
  const inv = new Map(invoices.map((i) => [i.fakturowniaInvoiceId, i]));
  const invoiceOut = (id: number) => {
    const i = inv.get(id);
    return i
      ? { faktura_id: i.fakturowniaInvoiceId, numer: i.number, nabywca: i.buyerName, nip: i.buyerTaxNo, brutto: i.totalGross.toString(), klient: i.client ? { id: i.client.id, nazwa: i.client.name } : null }
      : { faktura_id: id, numer: null, nabywca: null, nip: null, brutto: null, klient: null };
  };

  // Nieopłacone faktury w zakresie śledzenia wpłat (od BANK_STATEMENT_SINCE).
  const today = new Date();
  const unpaidRows = await prisma.clientInvoice.findMany({
    where: {
      issueDate: { gte: day(BANK_STATEMENT_SINCE) },
      NOT: { paymentType: "cash" },
      ...(q.clientId ? { clientId: q.clientId } : {}),
    },
    orderBy: { issueDate: "asc" },
    include: { client: { select: { id: true, name: true } } },
  });
  const paidIds = new Set(
    (await prisma.fakturowniaPayment.findMany({ where: { fakturowniaInvoiceId: { in: unpaidRows.map((r) => r.fakturowniaInvoiceId) } }, select: { fakturowniaInvoiceId: true } })).map(
      (p) => p.fakturowniaInvoiceId,
    ),
  );
  const unpaid = unpaidRows
    .filter((r) => !paidIds.has(r.fakturowniaInvoiceId))
    .map((r) => {
      const status = invoicePaymentStatus({ paidAt: null, paymentType: r.paymentType, paymentTo: r.paymentTo, issueDate: r.issueDate, cashConfirmed: false }, today, coverage);
      return {
        faktura_id: r.fakturowniaInvoiceId,
        numer: r.number,
        wystawiona: ymd(r.issueDate),
        termin: r.paymentTo ? ymd(r.paymentTo) : null,
        nabywca: r.buyerName,
        nip: r.buyerTaxNo,
        brutto: r.totalGross.toString(),
        klient: r.client ? { id: r.client.id, nazwa: r.client.name } : null,
        status: status.kind,
        status_opis: paymentLabel(status),
      };
    });

  return {
    ostatni_import: lastUpload
      ? {
          wgrano: lastUpload.uploadedAt.toISOString(),
          plik: lastUpload.fileName,
          okres_od: lastUpload.periodFrom ? ymd(lastUpload.periodFrom) : null,
          okres_do: lastUpload.periodTo ? ymd(lastUpload.periodTo) : null,
        }
      : null,
    wplaty_aktualne_na: coverage ? ymd(coverage.to) : null,
    sprawdzane_faktury_od: BANK_STATEMENT_SINCE,
    przelewy: transfers.map((t) => ({
      id: t.id,
      data: ymd(t.bookedAt),
      kwota: t.amount.toString(),
      opis: t.description,
      stan: t.matchState,
      stan_opis: STATE_LABEL[t.matchState] ?? t.matchState,
      faktura: t.fakturowniaInvoiceId != null ? invoiceOut(t.fakturowniaInvoiceId) : null,
      kandydaci: Array.isArray(t.candidates) ? (t.candidates as number[]).map(invoiceOut) : [],
    })),
    przelewy_razem: total,
    nieoplacone_faktury: unpaid,
  };
}
