import { notFound } from "next/navigation";
import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadClientDetail } from "@/lib/clients/load";
import { ClientFullCard } from "@/components/clients/card/client-full-card";
import type { CardTab } from "@/components/clients/card/tab-overview";

const TABS: CardTab[] = ["przeglad", "transakcje", "komunikacja", "dane"];

// Pełna karta klienta z zakładkami (docs/crm/prompt-claude-code-crm-3b-karta-klienta.md).
// ADMIN/STAFF, jak cały moduł Klienci; KIEROWCA przekierowany.
export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const session = await requireClientsPageAccess();
  const { id } = await params;
  const { tab } = await searchParams;
  const detail = await loadClientDetail(id);
  if (!detail) notFound();
  return (
    <ClientFullCard
      key={id}
      initial={detail}
      initialTab={TABS.includes(tab as CardTab) ? (tab as CardTab) : "przeglad"}
      isAdmin={session.user.role === "ADMIN"}
    />
  );
}
