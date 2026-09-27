import { prisma } from "@/lib/prisma";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges } from "@/lib/changelog/record";

// Faktura opłacona gotówką — oznaczenie ręczne z karty klienta (data, kto
// przyjął). Klient może płacić raz gotówką, raz przelewem; bez tego brak
// przelewu wyglądałby na zaległość. Wpis w dzienniku zmian.

export type CashResult = { ok: true; clientId: string | null } | { ok: false; status: number; message: string };

const day = (s: string) => new Date(`${s}T12:00:00.000Z`);

export async function markInvoiceCash(fakturowniaInvoiceId: number, input: { date: string; receivedBy: string | null; note: string | null }, userId: string): Promise<CashResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, status: 400, message: "Podaj datę zapłaty (RRRR-MM-DD)." };
  const invoice = await prisma.clientInvoice.findUnique({ where: { fakturowniaInvoiceId }, select: { number: true, clientId: true } });
  if (!invoice) return { ok: false, status: 404, message: "Nie znaleziono faktury." };
  const existing = await prisma.fakturowniaPayment.findUnique({ where: { fakturowniaInvoiceId } });
  if (existing && existing.method === "TRANSFER") return { ok: false, status: 409, message: "Faktura jest już opłacona przelewem z wyciągu." };
  const paidAt = day(input.date);
  await prisma.$transaction(async (tx) => {
    await tx.fakturowniaPayment.upsert({
      where: { fakturowniaInvoiceId },
      create: { fakturowniaInvoiceId, paidAt, method: "CASH", receivedBy: input.receivedBy, note: input.note, markedById: userId },
      update: { paidAt, method: "CASH", receivedBy: input.receivedBy, note: input.note, markedById: userId, bankTransferId: null },
    });
    await recordChanges(tx, { userId }, [
      {
        entity: "INVOICE",
        entityId: String(fakturowniaInvoiceId),
        clientId: invoice.clientId,
        operation: "PAYMENT_MATCH",
        field: "wpłata",
        before: toLogValue(existing ? { faktura: invoice.number, zaplacona: existing.paidAt, sposob: existing.method } : { faktura: invoice.number, zaplacona: false }),
        after: toLogValue({ faktura: invoice.number, gotowka: input.date, przyjal: input.receivedBy }),
      },
    ]);
  });
  return { ok: true, clientId: invoice.clientId };
}

export async function unmarkInvoiceCash(fakturowniaInvoiceId: number, userId: string): Promise<CashResult> {
  const invoice = await prisma.clientInvoice.findUnique({ where: { fakturowniaInvoiceId }, select: { number: true, clientId: true } });
  const existing = await prisma.fakturowniaPayment.findUnique({ where: { fakturowniaInvoiceId } });
  if (!existing || existing.method !== "CASH") return { ok: false, status: 409, message: "Faktura nie jest oznaczona jako opłacona gotówką." };
  await prisma.$transaction(async (tx) => {
    await tx.fakturowniaPayment.delete({ where: { fakturowniaInvoiceId } });
    await recordChanges(tx, { userId }, [
      {
        entity: "INVOICE",
        entityId: String(fakturowniaInvoiceId),
        clientId: invoice?.clientId ?? null,
        operation: "PAYMENT_MATCH",
        field: "wpłata",
        before: toLogValue({ faktura: invoice?.number, gotowka: existing.paidAt, przyjal: existing.receivedBy }),
        after: toLogValue({ faktura: invoice?.number, zaplacona: false }),
      },
    ]);
  });
  return { ok: true, clientId: invoice?.clientId ?? null };
}
