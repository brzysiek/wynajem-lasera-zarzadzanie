import { auth } from "@/auth";
import { requireAdmin } from "@/lib/auth-guards";
import { isoDate, monthPeriod } from "@/lib/revenue/period";
import { InvoicesManager } from "@/components/invoices-manager";
import { FvWithoutInvoicePanel } from "@/components/fv-without-invoice-panel";

// Piąta podpozycja Finansów — lustrzane odbicie "Faktury paliwa" (tam:
// zakupy/koszty, tu: sprzedaż/przychody). WŁASNY, niezależny filtr okresu,
// jak "Wpisy kosztów"/"Faktury paliwa" (nie współdzielony ze stanem
// Przychody↔Koszty). ADMIN — pełna obsługa; AGENT — tylko odczyt (lista,
// PDF, „FV bez faktury”); pozostali — przekierowanie.
export default async function InvoicesPage() {
  const session = await auth();
  const isAgent = session?.user.role === "AGENT";
  if (!isAgent) await requireAdmin();

  // Domyślnie ostatnie 3 miesiące (np. 3.10 → od 1.08), żeby niezapłacone
  // faktury z poprzednich miesięcy były widoczne od razu.
  const now = new Date();
  const period = { start: monthPeriod(now.getFullYear(), now.getMonth() - 1).start, end: monthPeriod(now.getFullYear(), now.getMonth() + 1).end };

  return (
    <div className="flex flex-col gap-4">
      <FvWithoutInvoicePanel canLink={!isAgent} />
      <InvoicesManager initialFrom={isoDate(period.start)} initialTo={isoDate(period.end)} readOnly={isAgent} />
    </div>
  );
}
