import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return <AppShell userName={session.user.name ?? session.user.email ?? "Użytkownik"}>{children}</AppShell>;
}
