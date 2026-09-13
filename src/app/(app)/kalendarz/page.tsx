import { cookies } from "next/headers";
import { auth } from "@/auth";
import { VIEW_COOKIE, actsAsDriver } from "@/lib/effective-role";
import { CalendarView } from "@/components/calendar-view";

export default async function CalendarPage() {
  const session = await auth();
  const viewCookie = (await cookies()).get(VIEW_COOKIE)?.value;
  const driverMode = actsAsDriver(session?.user.role, session?.user.canActAsDriver, viewCookie);

  // Ostrzeżenia (wynajmy bez kierowcy/kontaktu/telefonu) już nie są ładowane
  // tutaj jako baner — mieszkają na prawym pasku ikon (auto-pop po wejściu na
  // tę stronę), patrz src/components/notifications-context.tsx + GET
  // /api/rentals/alerts. Lista urządzeń do filtra tak samo idzie przez
  // współdzielony CalendarDeviceFilterProvider (AppShell), nie przez props tej strony.
  return <CalendarView canEdit={!driverMode} />;
}
