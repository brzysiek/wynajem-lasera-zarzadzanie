import { auth } from "@/auth";
import { SettingsTabs } from "@/components/settings-tabs";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const isAdmin = session?.user.role === "ADMIN";

  return (
    <div>
      <SettingsTabs isAdmin={isAdmin} />
      {children}
    </div>
  );
}
