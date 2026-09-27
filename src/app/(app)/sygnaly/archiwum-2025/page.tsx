import { requireAdmin } from "@/lib/auth-guards";
import { listArchive2025Candidates } from "@/lib/leads/cleanup";
import { Archive2025Review } from "@/components/leads/archive-2025";

// Lejek, jednorazowo: otwarte sygnały sprzed 2026 → archiwum „2025 – bez
// kontaktu”. Tomek przegląda listę i archiwizuje zaznaczone (bez usuwania).
export default async function Archive2025Page() {
  await requireAdmin();
  return <Archive2025Review initial={await listArchive2025Candidates()} />;
}
