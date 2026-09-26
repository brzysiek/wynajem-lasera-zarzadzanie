import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { VIEW_COOKIE, actsAsDriver } from "@/lib/effective-role";

// Strony modułu Klienci i Sygnały: ADMIN, STAFF i AGENT (agent AI — zapisy
// ograniczone w API, src/lib/permissions.ts), nie w „podglądzie kierowcy”
// (spec, sekcja 4) — dane zawierają przychód i notatki.
export async function requireClientsPageAccess() {
  const session = await auth();
  const role = session?.user.role;
  const viewCookie = (await cookies()).get(VIEW_COOKIE)?.value;
  if (!session || (role !== "ADMIN" && role !== "STAFF" && role !== "AGENT") || actsAsDriver(role, session.user.canActAsDriver, viewCookie)) {
    redirect("/kalendarz");
  }
  return session;
}
