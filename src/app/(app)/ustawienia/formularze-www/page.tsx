import { PageHeader } from "@/components/page-header";
import { WwwIntakePanel } from "@/components/www-intake-panel";

// Ustawienia → Zapytania i skrzynka → Formularze WWW → sygnały (wniosek 55): dawniej schowane w Integracje → HubSpot.
export default function WwwFormsSettingsPage() {
  return (
    <div>
      <PageHeader title="Formularze WWW → sygnały" description="Zgłoszenia z formularzy wynajemlasera.pl trafiają prosto do sygnałów. Tu: adres webhooka, ostatnie zgłoszenia i ich obsługa." />
      <WwwIntakePanel />
    </div>
  );
}
