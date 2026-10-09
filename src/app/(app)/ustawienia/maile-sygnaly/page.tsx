import { requireAdmin } from "@/lib/auth-guards";
import { PageHeader } from "@/components/page-header";
import { MailIntakeSettings } from "@/components/settings/mail-intake-settings";
import { loadIntakeConfig } from "@/lib/leads/mail-intake";
import { DEFAULT_CONFIG } from "@/lib/leads/mail-intake-rules";

// Filtr maili od nowych osób (wniosek 43) — słowa, domeny, progi i tryb. ADMIN.
export default async function MailIntakeSettingsPage() {
  await requireAdmin();
  const config = await loadIntakeConfig();
  return (
    <div>
      <PageHeader
        title="Maile → sygnały"
        description="Jak panel ocenia maile przychodzące na kontakt@ od nowych osób. Reguły są proste i widoczne tutaj: punkty za słowa, zablokowane domeny i dwa progi. Tryb ostrożny nie zakłada sygnałów sam — wszystko, co wygląda na zapytanie, trafia do „Do sprawdzenia”. Panel niczego nie zmienia w Gmailu."
      />
      <MailIntakeSettings initial={config} defaults={DEFAULT_CONFIG} />
    </div>
  );
}
