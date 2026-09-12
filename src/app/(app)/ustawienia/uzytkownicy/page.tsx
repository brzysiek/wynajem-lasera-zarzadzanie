import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { UsersPanel } from "@/components/users-panel";

export default async function UsersSettingsPage() {
  const session = await requireAdmin();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      canActAsDriver: true,
      grammaticalGender: true,
      hourlyRate: true,
      invitedAt: true,
      activatedAt: true,
      createdAt: true,
    },
  });

  // requireAdmin() powyżej — bezpiecznie serializuje hourlyRate (ADMIN-only
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
