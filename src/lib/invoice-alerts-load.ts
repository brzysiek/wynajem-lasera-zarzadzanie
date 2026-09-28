import { prisma } from "@/lib/prisma";
import { formatPln } from "@/lib/pricing/format";
import { round2 } from "@/lib/pricing/total";
import { INVOICE_ALERT_SINCE, type InvoiceAlert } from "@/lib/invoice-alerts";

// Serwerowa (Prisma) część modelu "brak faktury" — src/lib/invoice-alerts.ts
// ma tylko typy/regułę i jest client-safe. Odpytywane przez
// GET /api/rentals/invoice-alerts (pasek ikon — notifications-context.tsx).
// Tylko wynajmy jeszcze NIEZAFAKTUROWANE (needed) — to jest lista "do
// zrobienia", nie log wszystkich zakończonych rozliczeń z VAT.
export async function loadInvoiceAlerts(): Promise<InvoiceAlert[]> {
  const now = new Date();

  const rows = await prisma.rental.findMany({
    where: {
      deletedInGoogle: false,
      endsAt: { lte: now, gte: INVOICE_ALERT_SINCE },
      finance: { vatApplicable: true, fakturowniaInvoiceId: null },
    },
    orderBy: { endsAt: "desc" },
    select: {
      id: true,
      title: true,
      endsAt: true,
      device: { select: { name: true, color: true } },
      finance: { select: { totalNet: true, totalGross: true, vatApplicable: true, invoiceNet: true, invoiceNetPending: true, vatRate: true } },
    },
  });

  return rows.map((r): InvoiceAlert => ({
    id: r.id,
    title: r.title,
    endsAt: r.endsAt.toISOString(),
    deviceName: r.device.name,
    deviceColor: r.device.color,
    // Faktura na część (warunki klienta) — brutto samej części.
    amount: r.finance?.vatApplicable && r.finance.invoiceNetPending ? "kwota na FV do ustalenia" : formatPln(
      r.finance?.vatApplicable
        ? r.finance.invoiceNet != null && r.finance.invoiceNet.lessThan(r.finance.totalNet)
          ? round2(r.finance.invoiceNet.times(r.finance.vatRate.div(100).plus(1)))
          : r.finance.totalGross
        : (r.finance?.totalNet ?? 0),
    ),
  }));
}
