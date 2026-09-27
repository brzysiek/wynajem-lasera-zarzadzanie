import { notFound } from "next/navigation";
import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadClientDetail } from "@/lib/clients/load";
import { loadClientOptions } from "@/lib/porzadki/client-options";
import { countPendingForClient } from "@/lib/porzadki/change-proposals";
import { ClientFullCard } from "@/components/clients/card/client-full-card";
import { AgentModeProvider } from "@/components/clients/client-forms";
import type { CardTab } from "@/components/clients/card/tab-overview";

const TABS: CardTab[] = ["karta", "przeglad", "transakcje", "komunikacja", "dane"];

// Pełna karta klienta: domyślnie układ wg karta-klienta-wzor.html
// (prompt-code-karta-klienta.md, sekcja 2); dawne zakładki pod ?tab=
// (przeglad, transakcje, komunikacja, dane).
// ADMIN/STAFF/AGENT, jak cały moduł Klienci; KIEROWCA przekierowany.
export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const session = await requireClientsPageAccess();
  const { id } = await params;
  const { tab } = await searchParams;
  const [detail, mergeOptions, pendingProposals] = await Promise.all([loadClientDetail(id), loadClientOptions(), countPendingForClient(id)]);
  if (!detail) notFound();
  return (
    <AgentModeProvider agent={session.user.role === "AGENT"}>
      <ClientFullCard
        key={id}
        initial={detail}
        initialTab={TABS.includes(tab as CardTab) ? (tab as CardTab) : "karta"}
        isAdmin={session.user.role === "ADMIN"}
        isAgent={session.user.role === "AGENT"}
        mergeOptions={mergeOptions}
        pendingProposals={pendingProposals}
      />
    </AgentModeProvider>
  );
}
