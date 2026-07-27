import { requireAdmin } from "@/lib/auth-guards";
import { PageHeader } from "@/components/page-header";
import { IntegrationsTabs } from "@/components/integrations-tabs";

export default async function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div>
      <PageHeader
        title="Integracje"
        description="Połączenia z zewnętrznymi usługami — status, test połączenia i instrukcje konfiguracji."
      />
      <IntegrationsTabs />
      {children}
    </div>
  );
}
