import { requireAdmin } from "@/lib/auth-guards";
import { PageHeader } from "@/components/page-header";
import { GoogleConversionsPanel } from "@/components/settings/google-conversions-panel";
import { conversionPreview } from "@/lib/leads/google-conversions-load";

// Konwersje offline do Google Ads (wniosek 54, etap 1) — podgląd i plik CSV
// do ręcznego wgrania. Tylko ADMIN; do Google trafiają wyłącznie sygnały ze
// zgodą marketingową.
export default async function GoogleConversionsPage() {
  await requireAdmin();
  const p = await conversionPreview();
  return (
    <div>
      <PageHeader
        title="Konwersje Google Ads"
        description="Etapy sprzedaży z panelu (rozmowa, oferta, rezerwacja, wynajem) jako konwersje offline. Google przypisuje je do kliknięcia reklamy po identyfikatorze (gclid, gbraid, wbraid) i liczy tylko osoby, które zgodziły się na przekazanie danych — dlatego do pliku trafiają wyłącznie sygnały ze zgodą marketingową z formularza."
      />
      <GoogleConversionsPanel
        initial={{
          pending: p.pending.length,
          already: p.already,
          leadsChecked: p.leadsChecked,
          leadsEligible: p.leadsEligible,
          skipped: p.skipped,
          byName: p.byName,
        }}
      />
    </div>
  );
}
