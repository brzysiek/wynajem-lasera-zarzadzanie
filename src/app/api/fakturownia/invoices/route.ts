import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { listInvoices } from "@/lib/integrations/fakturownia";

// Lista faktur w zadanym okresie — dane na żywo z Fakturowni (nie z naszej
// bazy, żeby nie duplikować stanu który i tak może się zmienić po ich
// stronie: korekty, ręczna wysyłka do KSeF). Jedyne co dokładamy lokalnie to
// status "zapłacona" (FakturowniaPayment, keyed po ID faktury z Fakturowni,
// NIEZALEŻNIE od tego czy faktura ma odpowiednik w Rental/RentalFinance —
// większość faktur w dziale nie ma). Fakturownia nie wie, czy faktura jest
// zapłacona (brak płatnego połączenia z bankiem), więc to ustalamy sami
// (dashboard /finanse/faktury, wgrywanie wyciągu bankowego).
export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ message: "Wymagane parametry from i to." }, { status: 400 });
  }

  try {
    const invoices = await listInvoices({ dateFrom: from, dateTo: to });

    const ids = invoices.map((i) => i.id);
    const paidRows = ids.length
      ? await prisma.fakturowniaPayment.findMany({ where: { fakturowniaInvoiceId: { in: ids } } })
      : [];
    const paidById = new Map(paidRows.map((r) => [r.fakturowniaInvoiceId, r.paidAt]));

    return NextResponse.json({
      invoices: invoices.map((i) => ({ ...i, paidAt: paidById.get(i.id)?.toISOString() ?? null })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
