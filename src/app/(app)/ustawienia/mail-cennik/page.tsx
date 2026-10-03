import { requireAdmin } from "@/lib/auth-guards";
import { PageHeader } from "@/components/page-header";
import { AutoMailPanel } from "@/components/auto-mail-panel";
import { loadAutoMailConfig, recentAutoMails } from "@/lib/leads/auto-mail";

// Mail z cennikiem wysyłany automatycznie po formularzu „cennik” (04.10.2026) — ADMIN.
export default async function AutoMailPage() {
  const session = await requireAdmin();
  const [config, recent] = await Promise.all([loadAutoMailConfig(), recentAutoMails()]);
  return (
    <div>
      <PageHeader
        title="Mail z cennikiem"
        description="Gdy klient pobiera cennik formularzem na wynajemlasera.pl, panel od razu wysyła mu z kontakt@ ten mail z załącznikami — bez zatwierdzania. Wysłany mail widać w historii sygnału; nie liczy się jako kontakt ani oferta biura."
      />
      <AutoMailPanel
        initialConfig={config}
        initialRecent={recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null }))}
        myEmail={session.user.email ?? ""}
      />
    </div>
  );
}
