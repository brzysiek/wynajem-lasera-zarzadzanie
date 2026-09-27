import { prisma } from "@/lib/prisma";
import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadArchived2025Rows, loadLeadRows, loadLinkSuggestions, loadStaffUsers, todayCallStats } from "@/lib/leads/load";
import { syncLeadsWithRentalsSafe } from "@/lib/leads/rental-link";
import { lastDealsSync } from "@/lib/leads/hubspot-sync";
import { LeadsManager } from "@/components/leads/leads-manager";
import { agentAssignees } from "@/lib/agent-api/assignees";

// Sygnały — miejsce pracy biura nad zapytaniami klientów (CRM, prompt 2A).
// ADMIN/STAFF, jak moduł Klienci; KIEROWCA przekierowany.
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const session = await requireClientsPageAccess();
  const { id } = await searchParams;
  // Lejek ↔ kalendarz: świeże powiązania przed odczytem (także bez crona).
  await syncLeadsWithRentalsSafe();
  const [rows, users, lastSync, clients] = await Promise.all([
    loadLeadRows(),
    // Agent przydziela zadania tylko wskazanym osobom (Tomek, Ania).
    session.user.role === "AGENT" ? agentAssignees() : loadStaffUsers(),
    lastDealsSync(),
    prisma.client.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true, contacts: { where: { isPrimary: true }, take: 1, select: { firstName: true, lastName: true } } },
    }),
  ]);
  const [linkSuggestions, callStats, archivedRows] = await Promise.all([loadLinkSuggestions(rows), todayCallStats(), loadArchived2025Rows()]);
  return (
    <LeadsManager
      rows={rows}
      users={users}
      currentUserId={session.user.id}
      isAdmin={session.user.role === "ADMIN"}
      readOnly={session.user.role === "AGENT"}
      linkSuggestions={linkSuggestions}
      callStats={callStats}
      archivedRows={archivedRows}
      lastSync={lastSync}
      hubspotConfigured={Boolean(process.env.HUBSPOT_ACCESS_TOKEN)}
      clients={clients.map((c) => {
        const p = c.contacts[0];
        const person = p ? [p.firstName, p.lastName].filter(Boolean).join(" ") || null : null;
        return { id: c.id, name: c.name, city: c.city, person: person && person !== c.name ? person : null };
      })}
      initialSelectedId={id ?? null}
    />
  );
}
