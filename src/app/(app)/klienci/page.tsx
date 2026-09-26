import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadClientRows } from "@/lib/clients/load";
import { countPendingHistory } from "@/lib/history/review-load";
import { ClientsManager } from "@/components/clients/clients-manager";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireClientsPageAccess();
  const query = await searchParams;
  const [rows, pendingHistory] = await Promise.all([loadClientRows(), countPendingHistory()]);
  return <ClientsManager rows={rows} initialSelectedId={null} initialQuery={query} pendingHistory={pendingHistory} />;
}
