import { CostImport } from "@/components/marketing/cost-import";
import { GoogleConversionsPanel } from "@/components/settings/google-conversions-panel";
import { conversionPreview } from "@/lib/leads/google-conversions-load";
import { costStatus } from "@/lib/marketing/load";

// Marketing → Ustawienia pomiaru (wniosek 54, etap 1c): import kosztów z Google Ads
// i eksport konwersji do Google (CSV). Tylko ADMIN (layout Marketingu).
export default async function MeasurementSettingsPage() {
  const [status, p] = await Promise.all([costStatus(), conversionPreview()]);
  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Import kosztów</h2>
        <p className="mb-4 mt-0 text-sm text-gray-500">Koszty, kliknięcia i wyświetlenia z Google Ads per dzień, kampania, grupa i słowo kluczowe — z pliku CSV raportu słów kluczowych.</p>
        <CostImport initial={status} />
      </section>
      <section>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Konwersje Google (eksport CSV)</h2>
        <p className="mb-4 mt-0 text-sm text-gray-500">
          Etapy sprzedaży z panelu (rozmowa, oferta, rezerwacja, wynajem) jako konwersje offline. Google liczy tylko osoby, które zgodziły się na przekazanie danych — dlatego do pliku trafiają wyłącznie sygnały ze zgodą marketingową z formularza.
        </p>
        <GoogleConversionsPanel
          initial={{ pending: p.pending.length, already: p.already, leadsChecked: p.leadsChecked, leadsEligible: p.leadsEligible, skipped: p.skipped, byName: p.byName }}
        />
      </section>
    </div>
  );
}
