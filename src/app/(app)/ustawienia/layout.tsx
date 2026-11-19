import { requireOffice } from "@/lib/auth-guards";
import { SettingsNav } from "@/components/settings-nav";
import { APP_CSS_VARS } from "@/components/shell-tokens";

// Ustawienia (wniosek 55): menu boczne z 6 grupami; ADMIN i STAFF widzą całość (STAFF
// w pozycjach Użytkownicy / Integracje / Messenger / Importy tylko podgląd).
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOffice();
  return (
    <div style={APP_CSS_VARS} className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <SettingsNav role={session?.user.role} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
