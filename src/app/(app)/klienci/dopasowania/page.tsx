import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadHistoryReview } from "@/lib/history/review-load";
import { loadUnassignedRentals } from "@/lib/clients/rental-match";
import { HistoryReview } from "@/components/clients/history-review";
import { UnassignedRentals } from "@/components/clients/unassigned-rentals";

// Przegląd dopasowań historii z kalendarzy do klientów (CRM, prompt 3A).
// ADMIN/STAFF, jak cały moduł Klienci. Na górze — rezerwacje bez klienta
// (wniosek 13); agent je widzi, ale potwierdza tylko biuro.
export default async function HistoryMatchesPage() {
  const session = await requireClientsPageAccess();
  const [data, rentals] = await Promise.all([loadHistoryReview(), loadUnassignedRentals()]);
  return (
    <div className="flex flex-col gap-5">
      {session.user.role !== "AGENT" && <UnassignedRentals rentals={rentals} clients={data.clients} />}
      <HistoryReview data={data} />
    </div>
  );
}
