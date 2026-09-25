import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadHistoryReview } from "@/lib/history/review-load";
import { HistoryReview } from "@/components/clients/history-review";

// Przegląd dopasowań historii z kalendarzy do klientów (CRM, prompt 3A).
// ADMIN/STAFF, jak cały moduł Klienci.
export default async function HistoryMatchesPage() {
  await requireClientsPageAccess();
  const data = await loadHistoryReview();
  return <HistoryReview data={data} />;
}
