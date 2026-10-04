import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { listProposals } from "@/lib/porzadki/proposals";
import { loadPorzadkiPeople } from "@/lib/porzadki/people";
import { loadAreas } from "@/lib/porzadki/areas";
import { ProposalsList } from "@/components/porzadki/proposals-list";

// Porządki → Skrzynka (04.10.2026): wnioski z obszarów niedeweloperskich
// (proposal_areas.dev = false) — pomysły i sprawy biznesowe Tomka, nie
// backlog panelu.
export default async function InboxPage() {
  const session = await requireClientsPageAccess();
  const [{ rows, counts }, authors, areas] = await Promise.all([listProposals({ scope: "inbox" }), loadPorzadkiPeople(), loadAreas()]);
  return <ProposalsList rows={rows} counts={counts} authors={authors} areas={areas.filter((a) => !a.dev)} inbox isAdmin={session.user.role === "ADMIN"} />;
}
