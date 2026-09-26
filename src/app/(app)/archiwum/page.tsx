import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadPorzadkiPeople } from "@/lib/porzadki/people";
import { PorzadkiLayout } from "@/components/porzadki/shared";
import { ArchivePanel } from "@/components/porzadki/archive-panel";

// Porządki → Archiwum. Odczyt: ADMIN/STAFF/AGENT; „Przywróć” i „Usuń trwale” — tylko ADMIN.
export default async function ArchivePage() {
  const session = await requireClientsPageAccess();
  return (
    <PorzadkiLayout
      title="Archiwum"
      description="Kontakty spoza bazy: spam, testy, osoby prywatne, spoza branży, duplikaty. Nie ma ich na listach ani w wyszukiwaniu; HubSpot bez zmian."
    >
      <ArchivePanel canManage={session.user.role === "ADMIN"} users={await loadPorzadkiPeople()} />
    </PorzadkiLayout>
  );
}
