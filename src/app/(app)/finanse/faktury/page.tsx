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
      {!isAgent && (
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="m-0 mb-1 text-base font-semibold text-gray-900">Szkice maili z fakturami (Gmail)</h2>
          <p className="m-0 text-sm text-gray-600">
            Przycisk „Utwórz szkic maila” tworzy szkic w Gmailu konta z konfiguracji Google (to samo konto serwisowe co Kalendarz, zakres <code className="rounded bg-gray-100 px-1 font-mono text-xs">gmail.compose</code>). Wysyłka NIE dzieje się automatycznie — biuro przegląda szkic i wysyła go ręcznie z Gmaila. Nadawcą szkicu jest <code className="rounded bg-gray-100 px-1 font-mono text-xs">rozliczenia@wynajemlasera.pl</code> — musi to być skonfigurowany alias „wysyłaj jako” w Gmailu (Ustawienia → Konta i importowanie → Wysyłaj pocztę jako), inaczej Gmail odrzuci szkic.
          </p>
        </section>
      )}
      <FvWithoutInvoicePanel canLink={!isAgent} />
      <InvoicesManager initialFrom={isoDate(period.start)} initialTo={isoDate(period.end)} readOnly={isAgent} />
    </div>
  );
}
