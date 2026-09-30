import { prisma } from "@/lib/prisma";
import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadSeasonGoal } from "@/lib/leads/season-goal-load";
import { loadFreeByInterest, loadSignalTasks } from "@/lib/leads/today-extras";
import { loadArchived2025Rows, loadDayProgress, loadLeadRows, loadLinkSuggestions, loadStaffUsers, todayCallStats } from "@/lib/leads/load";
import { syncLeadsWithRentalsSafe } from "@/lib/leads/rental-link";
import { lastDealsSync } from "@/lib/leads/hubspot-sync";
import { LeadsManager } from "@/components/leads/leads-manager";
import { agentAssignees } from "@/lib/agent-api/assignees";
import { loadPlaybook } from "@/lib/leads/playbook-load";
import { shouldShowTour, vocative } from "@/lib/tours";

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
  const office = session.user.role === "ADMIN" || session.user.role === "STAFF";
  const [linkSuggestions, callStats, archivedRows, playbook, progress, showTourV4] = await Promise.all([
    loadLinkSuggestions(rows),
    todayCallStats(),
    loadArchived2025Rows(),
    loadPlaybook(),
    loadDayProgress(),
    // Przewodnik „Tablica – jak pracujemy” (v4) — zastępuje v2 i v3.
    office ? shouldShowTour(session.user.id, "signalsV4") : false,
  ]);
  const [seasonGoal, freeByInterest, signalTasks] = await Promise.all([loadSeasonGoal(playbook.season), loadFreeByInterest().catch(() => ({})), loadSignalTasks()]);
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
      playbook={playbook}
      progress={progress}
      seasonGoal={seasonGoal}
      freeByInterest={freeByInterest}
      signalTasks={signalTasks}
      tour={{ show: false, showV3: false, showV4: showTourV4, name: vocative(session.user.name ?? "") }}
    />
  );
}
