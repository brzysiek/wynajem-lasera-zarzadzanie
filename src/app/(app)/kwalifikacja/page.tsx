import { requireAdmin } from "@/lib/auth-guards";
import { PorzadkiLayout } from "@/components/porzadki/shared";
import { ClientsQualificationPanel } from "@/components/clients-qualification-panel";
import { getHubspotConfigStatus } from "@/lib/integrations/hubspot";

// Porządki → Kwalifikacja (wniosek 55): kwalifikacja kontaktów z zapytań do klientów — to praca
// porządkowa, dawniej schowana w Ustawienia → Integracje → HubSpot. Tylko ADMIN (API też).
export default async function QualificationPage() {
  await requireAdmin();
  return (
    <PorzadkiLayout title="Kwalifikacja kontaktów" description="Klienci i kontakty z zapytań: podgląd, co porządkować, i zastosowanie zmian po akceptacji.">
      <ClientsQualificationPanel configured={getHubspotConfigStatus().configured} />
    </PorzadkiLayout>
  );
}
