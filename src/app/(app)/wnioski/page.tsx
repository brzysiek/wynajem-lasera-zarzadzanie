import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { listProposals } from "@/lib/porzadki/proposals";
import { loadPorzadkiPeople } from "@/lib/porzadki/people";
import { ProposalsList } from "@/components/porzadki/proposals-list";

// Porządki → Wnioski (ADMIN/STAFF/AGENT; KIEROWCA przekierowany).
export default async function ProposalsPage() {
  const session = await requireClientsPageAccess();
  const [{ rows, counts }, authors] = await Promise.all([listProposals(), loadPorzadkiPeople()]);
  return <ProposalsList rows={rows} counts={counts} authors={authors} isAdmin={session.user.role === "ADMIN"} />;
}
