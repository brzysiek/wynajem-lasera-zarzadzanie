import { requireAdmin } from "@/lib/auth-guards";
import { isoDate, monthPeriod } from "@/lib/revenue/period";
import { InvoicesManager } from "@/components/invoices-manager";

// Piąta podpozycja Finansów — lustrzane odbicie "Faktury paliwa" (tam:
// zakupy/koszty, tu: sprzedaż/przychody). WŁASNY, niezależny filtr okresu,
// jak "Wpisy kosztów"/"Faktury paliwa" (nie współdzielony ze stanem
// Przychody↔Koszty).
export default async function InvoicesPage() {
  await requireAdmin();

  const now = new Date();
  const period = monthPeriod(now.getFullYear(), now.getMonth() + 1);

  return <InvoicesManager initialFrom={isoDate(period.start)} initialTo={isoDate(period.end)} />;
}
