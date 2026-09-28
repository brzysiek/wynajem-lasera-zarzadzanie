import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth-guards";
import { loadPlaybook } from "@/lib/leads/playbook-load";
import { PlaybookEditor } from "@/components/leads/playbook-editor";

// Ustawienia → Ściąga: złote zasady obsługi zapytań, skrypty rozmów i cel
// sezonu (pasek w Skrzynce). Tylko ADMIN (Tomek).
export default async function PlaybookPage() {
  await requireAdmin();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ściąga" description="Złote zasady obsługi zapytań, skrypty rozmów w karcie sygnału i cel sezonu z nagrodą (pasek „Plan dnia” w Sygnały → Lista „Na dziś”)." />
      <PlaybookEditor initial={await loadPlaybook()} />
    </div>
  );
}
