import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { listProposals } from "@/lib/porzadki/proposals";
import { loadPorzadkiPeople } from "@/lib/porzadki/people";
import { loadAreas } from "@/lib/porzadki/areas";
import { ProposalsList } from "@/components/porzadki/proposals-list";

// Porządki → Wnioski (ADMIN/STAFF/AGENT; KIEROWCA przekierowany). Tylko
// obszary deweloperskie — skrzynka Tomka jest w /skrzynka.
export default async function ProposalsPage() {
  const session = await requireClientsPageAccess();
  const [{ rows, counts }, authors, areas] = await Promise.all([listProposals({ scope: "dev" }), loadPorzadkiPeople(), loadAreas()]);
  return <ProposalsList rows={rows} counts={counts} authors={authors} areas={areas.filter((a) => a.dev)} isAdmin={session.user.role === "ADMIN"} />;
}
