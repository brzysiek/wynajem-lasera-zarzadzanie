import { requireAdmin } from "@/lib/auth-guards";
import { PageHeader } from "@/components/page-header";

export default async function GatewaySettingsPage() {
  await requireAdmin();

  return (
    <div>
      <PageHeader title="Bramka" description="Konfiguracja bramki SMS do wysyłki przypomnień." />
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-400">
        Widok w budowie
      </div>
    </div>
  );
}
