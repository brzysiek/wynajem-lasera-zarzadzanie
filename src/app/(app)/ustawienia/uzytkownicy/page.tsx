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
      invitedAt: true,
      activatedAt: true,
      createdAt: true,
    },
  });

  const usersData = users.map((user) => ({
    ...user,
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
