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

  // Tylko faktury RZECZYWIŚCIE powiązane z wynajmem w tej apce (mają
  // fakturowniaInvoiceId w naszej bazie) mogą zostać oznaczone jako
  // zapłacone — dział w Fakturowni mógł mieć faktury wystawione ręcznie,
  // zanim ta integracja powstała, a tych apka nie śledzi i nie ma czego
  // zaktualizować (wcześniejszy bug: dopasowanie mogło "trafić" w taką
  // fakturę, updateMany nic nie zmieniał, a komunikat i tak mówił "oznaczono").
  const invoiceIds = allInvoices.map((i) => i.id);
  const trackedRows = invoiceIds.length
    ? await prisma.rentalFinance.findMany({
        where: { fakturowniaInvoiceId: { in: invoiceIds } },
        select: { fakturowniaInvoiceId: true, paidAt: true },
      })
    : [];
  const trackedById = new Map(trackedRows.map((r) => [r.fakturowniaInvoiceId as number, r.paidAt]));
  const unpaidInvoices = allInvoices.filter((i) => trackedById.has(i.id) && trackedById.get(i.id) == null);

  const matches = matchTransactionsToInvoices(transactions, unpaidInvoices);
  const confident = matches.filter((m) => m.candidates.length === 1);
  const ambiguous = matches.filter((m) => m.candidates.length > 1);

  // Faktyczna liczba zaktualizowanych wierszy — NIE ufamy `confident.length`
  // bezkrytycznie, bo to właśnie ta rozbieżność powodowała fałszywy komunikat
  // o sukcesie bez realnej zmiany.
  let matchedCount = 0;
  if (confident.length > 0) {
    const result = await prisma.rentalFinance.updateMany({
      where: { fakturowniaInvoiceId: { in: confident.map((m) => m.invoiceId) } },
      data: { paidAt: new Date() },
    });
    matchedCount = result.count;
    if (matchedCount !== confident.length) {
      logWarn("fakturownia_bank_statement_count_mismatch", { expected: confident.length, actual: matchedCount });
    }
  }

  const invoiceById = new Map(allInvoices.map((i) => [i.id, i]));
  const matchedNumbers = confident
    .map((m) => invoiceById.get(m.invoiceId)?.number)
    .filter((n): n is string => Boolean(n));

  logInfo("fakturownia_bank_statement_processed", {
    userId: session.user.id,
    transactionsParsed: transactions.length,
    unpaidInvoices: unpaidInvoices.length,
    autoMatched: matchedCount,
    ambiguous: ambiguous.length,
  });
  if (ambiguous.length > 0) {
    logWarn("fakturownia_bank_statement_ambiguous", { invoiceIds: ambiguous.map((m) => m.invoiceId) });
  }

  return NextResponse.json({
    transactionsParsed: transactions.length,
    autoMatched: matchedCount,
    matchedNumbers,
    ambiguous: ambiguous.length,
    noMatch: unpaidInvoices.length - confident.length - ambiguous.length,
  });
}
