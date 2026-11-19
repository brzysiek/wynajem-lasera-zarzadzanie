import { requireAdmin } from "@/lib/auth-guards";
import { PageHeader } from "@/components/page-header";
import { CostImport } from "@/components/marketing/cost-import";
import { costStatus } from "@/lib/marketing/load";

// Marketing → Import kosztów z Google Ads (wniosek 54, etap 1b). Tylko ADMIN.
export default async function CostImportPage() {
  await requireAdmin();
  return (
    <div>
      <PageHeader title="Marketing → Import kosztów" description="Koszty, kliknięcia i wyświetlenia z Google Ads per dzień, kampania, grupa i słowo kluczowe — z pliku CSV raportu słów kluczowych." />
      <CostImport initial={await costStatus()} />
    </div>
  );
}
