import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { homeFor } from "@/lib/settings-nav";

// Wniosek 55: ADMIN ląduje na stronie startowej Ustawień, STAFF w grupie SMS.
export default async function SettingsIndexPage() {
  const session = await auth();
  redirect(homeFor(session?.user.role));
}
