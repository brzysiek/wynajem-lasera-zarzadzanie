import { requireOffice } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { UsersPanel } from "@/components/users-panel";

export default async function UsersSettingsPage() {
  const session = await requireOffice();

  // Wniosek 55: STAFF widzi tylko listę osób i ról — bez e-maili, stawek godzinowych, tokenów
  // i logu wywołań agenta AI (zmiany kont i dostępu agenta robi administrator; API zwraca 403).
  if (session?.user.role !== "ADMIN") {
    const rows = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, role: true, canActAsDriver: true } });
    const ROLE: Record<string, string> = { ADMIN: "administrator", STAFF: "biuro", KIEROWCA: "kierowca", AGENT: "agent AI" };
    return (
      <div>
        <PageHeader title="Użytkownicy" description="Konta użytkowników panelu." />
        <section className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-700">
          <p className="mt-0 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-blue-900">Tylko podgląd — konta, role i dostęp agenta AI (tokeny, log wywołań) zmienia administrator.</p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {rows.map((u) => (
              <li key={u.id} className="flex flex-wrap items-baseline gap-2 border-t border-gray-100 pt-1.5 first:border-t-0 first:pt-0">
                <b>{u.name}</b>
                <span className="text-gray-500">{ROLE[u.role] ?? u.role}{u.canActAsDriver ? " · jeździ jako kierowca" : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      canActAsDriver: true,
      agentAssignable: true,
      grammaticalGender: true,
      hourlyRate: true,
      driverColor: true,
      invitedAt: true,
      activatedAt: true,
      createdAt: true,
    },
  });

  // Kontrola roli ADMIN powyżej — bezpiecznie serializuje hourlyRate (ADMIN-only
  // strona; nigdy nie kopiuj tego selecta/mapowania do niczego dostępnego
  // roli KIEROWCA, docs/prompt-claude-code-dashboard-kosztow.md sekcja 1.4).
  const usersData = users.map((user) => ({
    ...user,
    hourlyRate: user.hourlyRate !== null ? user.hourlyRate.toString() : null,
    invitedAt: user.invitedAt ? user.invitedAt.toISOString() : null,
    activatedAt: user.activatedAt ? user.activatedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  }));

  return (
    <div>
      <PageHeader title="Użytkownicy" description="Zarządzanie kontami użytkowników panelu." />
      <UsersPanel users={usersData} currentUserId={session!.user.id} />
    </div>
  );
}
