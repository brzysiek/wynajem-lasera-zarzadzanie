import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadClientRows } from "@/lib/clients/load";
import { ClientsManager } from "@/components/clients/clients-manager";

export default async function ClientsPage() {
  await requireClientsPageAccess();
  const rows = await loadClientRows();
  return <ClientsManager rows={rows} initialSelectedId={null} />;
}
