import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadClientOptions } from "@/lib/porzadki/client-options";
import { PorzadkiLayout } from "@/components/porzadki/shared";
import { RemarksPanel } from "@/components/porzadki/remarks-panel";

// Porządki → Uwagi: obserwacje o klientach i danych, bez workflow.
export default async function RemarksPage() {
  await requireClientsPageAccess();
  const clientOptions = await loadClientOptions();
  return (
    <PorzadkiLayout title="Uwagi" description="Obserwacje, notatki i podejrzenia. Uwagę można jednym kliknięciem przekształcić we wniosek.">
      <RemarksPanel clientOptions={clientOptions} />
    </PorzadkiLayout>
  );
}
