import { requireAdmin } from "@/lib/auth-guards";
import { PageHeader } from "@/components/page-header";
import { ExclusionsPanel } from "@/components/porzadki/exclusions-panel";
import { listExclusions } from "@/lib/porzadki/exclusions";
import { getHideKeywords } from "@/lib/porzadki/exclusion-load";

// Lista wykluczeń domen i adresów (wniosek 7) — ADMIN.
export default async function ExclusionsPage() {
  await requireAdmin();
  const [rows, keywords] = await Promise.all([listExclusions(), getHideKeywords()]);
  return (
    <div>
      <PageHeader
        title="Wykluczenia maili"
        description="Domeny i adresy spoza branży: ich maile nie trafiają do panelu, a kontakty i transakcje z HubSpota nie tworzą klientów ani sygnałów. Domeny „ukrywaj” (np. kreatywnainzynieria.pl) są domyślnie ukryte w historii klienta, chyba że wątek dotyczy wynajmu. Nic nie jest usuwane — zdjęcie pozycji przywraca maile."
      />
      <ExclusionsPanel initialRows={rows} initialKeywords={keywords} />
    </div>
  );
}
