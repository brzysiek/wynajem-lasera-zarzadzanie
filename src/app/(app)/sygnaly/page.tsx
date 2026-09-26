import { prisma } from "@/lib/prisma";
import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadLeadRows, loadStaffUsers } from "@/lib/leads/load";
import { lastDealsSync } from "@/lib/leads/hubspot-sync";
import { leadStats } from "@/lib/leads/today";
import { LeadsManager } from "@/components/leads/leads-manager";

// Sygnały — miejsce pracy biura nad zapytaniami klientów (CRM, prompt 2A).
// ADMIN/STAFF, jak moduł Klienci; KIEROWCA przekierowany.
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const session = await requireClientsPageAccess();
  const { id } = await searchParams;
  const [rows, users, lastSync, clients] = await Promise.all([
    loadLeadRows(),
    loadStaffUsers(),
    lastDealsSync(),
    prisma.client.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true, contacts: { where: { isPrimary: true }, take: 1, select: { firstName: true, lastName: true } } },
    }),
  ]);
  const stats = leadStats(
    rows.map((r) => ({
      createdAt: new Date(r.createdAt),
      firstContactAt: r.firstContactAt ? new Date(r.firstContactAt) : null,
      stage: r.stage,
      stageChangedAt: new Date(r.stageChangedAt),
      lostReason: r.lostReason,
      hasRental: Boolean(r.rentalId),
    })),
    new Date(),
  );
  return (
    <LeadsManager
      rows={rows}
      users={users}
      currentUserId={session.user.id}
      isAdmin={session.user.role === "ADMIN"}
      stats={stats}
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
