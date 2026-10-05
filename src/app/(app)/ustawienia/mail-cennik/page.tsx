import { requireAdmin } from "@/lib/auth-guards";
import { PageHeader } from "@/components/page-header";
import { AutoMailPanel } from "@/components/auto-mail-panel";
import { loadAutoMailConfig, recentAutoMails } from "@/lib/leads/auto-mail";

// Maile automatyczne po formularzach WWW: cennik (04.10.2026) i
// potwierdzenie rezerwacji (05.10.2026) — ADMIN.
export default async function AutoMailPage() {
  const session = await requireAdmin();
  const [config, recent] = await Promise.all([loadAutoMailConfig(), recentAutoMails()]);
  return (
    <div>
      <PageHeader
        title="Maile automatyczne (formularze WWW)"
        description="Po formularzu „cennik” panel od razu wysyła z kontakt@ mail z cennikiem i katalogiem, a po formularzu rezerwacji — potwierdzenie z podsumowaniem zgłoszenia. Bez zatwierdzania; maile widać w historii sygnału i nie liczą się jako kontakt ani oferta biura."
      />
      <AutoMailPanel
        initialConfig={config}
        initialRecent={recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null }))}
        myEmail={session.user.email ?? ""}
      />
    </div>
  );
}
