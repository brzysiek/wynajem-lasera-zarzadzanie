import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { VIEW_COOKIE, actsAsDriver, isDriverPreview } from "@/lib/effective-role";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const viewCookie = (await cookies()).get(VIEW_COOKIE)?.value;
  const driverMode = actsAsDriver(session.user.role, session.user.canActAsDriver, viewCookie);
  const driverPreview = isDriverPreview(session.user.role, session.user.canActAsDriver, viewCookie);

  return (
    <AppShell
      userName={session.user.name ?? session.user.email ?? "Użytkownik"}
      userId={session.user.id}
      role={driverMode ? "KIEROWCA" : session.user.role}
      canActAsDriver={session.user.canActAsDriver && session.user.role !== "KIEROWCA"}
      driverPreview={driverPreview}
    >
      {children}
    </AppShell>
  );
}
