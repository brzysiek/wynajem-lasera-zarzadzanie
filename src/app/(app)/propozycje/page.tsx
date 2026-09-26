import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { PorzadkiLayout } from "@/components/porzadki/shared";
import { ProposalsQueue } from "@/components/porzadki/proposals-queue";

// Porządki → Propozycje: kolejka zmian od agenta do akceptacji. Odczyt:
// ADMIN/STAFF/AGENT; akceptacja, odrzucenie, poprawka i klasy — tylko ADMIN.
export default async function ChangeProposalsPage({ searchParams }: { searchParams: Promise<{ klient?: string }> }) {
  const session = await requireClientsPageAccess();
  const { klient } = await searchParams;
  return (
    <PorzadkiLayout
      title="Propozycje zmian"
      description="Zmiany danych przygotowane przez agenta. Akceptacja wykonuje je od razu i zapisuje w dzienniku z Tobą jako zatwierdzającym."
    >
      <ProposalsQueue canDecide={session.user.role === "ADMIN"} initialClientId={klient ?? null} />
    </PorzadkiLayout>
  );
}
