import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { listRules } from "@/lib/porzadki/cleanup-rules";
import { RulesManager } from "@/components/porzadki/rules-manager";

// Porządki → Reguły (czytają wszyscy, edytuje ADMIN).
export default async function RulesPage() {
  const session = await requireClientsPageAccess();
  return <RulesManager initial={await listRules()} canEdit={session.user.role === "ADMIN"} />;
}
