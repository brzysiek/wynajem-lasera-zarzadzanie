import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadClientRows } from "@/lib/clients/load";
import { countPendingHistory } from "@/lib/history/review-load";
import { ClientsManager } from "@/components/clients/clients-manager";

export default async function ClientsPage() {
  await requireClientsPageAccess();
  const [rows, pendingHistory] = await Promise.all([loadClientRows(), countPendingHistory()]);
  return <ClientsManager rows={rows} initialSelectedId={null} pendingHistory={pendingHistory} />;
}
