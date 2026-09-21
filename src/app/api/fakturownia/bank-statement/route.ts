import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { listInvoices } from "@/lib/integrations/fakturownia";
import { parseBankStatementCsv } from "@/lib/invoicing/bank-statement-parse";
import { matchTransactionsToInvoices } from "@/lib/invoicing/bank-match";
import { logInfo, logWarn } from "@/lib/logger";

function bad(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}

// Wgrywanie wyciągu bankowego (CSV z mBanku) — dopasowuje wpływy do
// NIEZAPŁACONYCH faktur (dowolny okres wystawienia, patrz listInvoices()
// bez dateFrom/dateTo = period=all — faktura mogła być wystawiona wcześniej
// niż zapłacona). Jedna faktura z dokładnie jednym kandydatem = od razu
// oznaczona jako zapłacona; więcej niż jeden kandydat albo brak — zostaje
// do ręcznego oznaczenia istniejącym przełącznikiem w dashboardzie (bez
// osobnego ekranu wyboru kandydata, patrz bank-match.ts).
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return bad("Brak uprawnień.", 403);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return bad("Brak pliku CSV.");

  const csvText = await file.text();
  const transactions = parseBankStatementCsv(csvText);
  if (transactions.length === 0) {
    return bad("Nie rozpoznano żadnych transakcji w pliku — sprawdź, czy to eksport CSV z mBanku.");
  }

  let allInvoices;
  try {
    allInvoices = await listInvoices();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }

  const invoiceIds = allInvoices.map((i) => i.id);
  const paidRows = invoiceIds.length
    ? await prisma.rentalFinance.findMany({
        where: { fakturowniaInvoiceId: { in: invoiceIds }, paidAt: { not: null } },
        select: { fakturowniaInvoiceId: true },
      })
    : [];
  const paidIds = new Set(paidRows.map((r) => r.fakturowniaInvoiceId));
  const unpaidInvoices = allInvoices.filter((i) => !paidIds.has(i.id));

  const matches = matchTransactionsToInvoices(transactions, unpaidInvoices);
  const confident = matches.filter((m) => m.candidates.length === 1);
  const ambiguous = matches.filter((m) => m.candidates.length > 1);

  if (confident.length > 0) {
    await prisma.rentalFinance.updateMany({
      where: { fakturowniaInvoiceId: { in: confident.map((m) => m.invoiceId) } },
      data: { paidAt: new Date() },
    });
  }

  logInfo("fakturownia_bank_statement_processed", {
    userId: session.user.id,
    transactionsParsed: transactions.length,
    unpaidInvoices: unpaidInvoices.length,
    autoMatched: confident.length,
    ambiguous: ambiguous.length,
  });
  if (ambiguous.length > 0) {
    logWarn("fakturownia_bank_statement_ambiguous", { invoiceIds: ambiguous.map((m) => m.invoiceId) });
  }

  return NextResponse.json({
    transactionsParsed: transactions.length,
    autoMatched: confident.length,
    ambiguous: ambiguous.length,
    noMatch: unpaidInvoices.length - confident.length - ambiguous.length,
  });
}
