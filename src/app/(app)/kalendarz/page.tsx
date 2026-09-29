import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { VIEW_COOKIE, actsAsDriver } from "@/lib/effective-role";
import { CalendarView } from "@/components/calendar-view";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Stały adres rezerwacji (wniosek 22): /kalendarz?wynajem=<rentalId> otwiera
// kartę rezerwacji, a „wstecz” wraca do kalendarza na dniu tej rezerwacji
// (/kalendarz?date=RRRR-MM-DD).
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ wynajem?: string; date?: string }> }) {
  const { wynajem, date } = await searchParams;
  if (wynajem) {
    const rental = await prisma.rental.findUnique({ where: { id: wynajem }, select: { id: true, startsAt: true } });
    if (!rental) notFound();
    redirect(`/kalendarz/wynajem/${rental.id}?from=/kalendarz&date=${ymd(rental.startsAt)}`);
  }
  const session = await auth();
  const viewCookie = (await cookies()).get(VIEW_COOKIE)?.value;
  const driverMode = actsAsDriver(session?.user.role, session?.user.canActAsDriver, viewCookie);

  // Ostrzeżenia (wynajmy bez kierowcy/kontaktu/telefonu) już nie są ładowane
  // tutaj jako baner — mieszkają na prawym pasku ikon (auto-pop po wejściu na
  // tę stronę), patrz src/components/notifications-context.tsx + GET
  // /api/rentals/alerts. Lista urządzeń do filtra tak samo idzie przez
  // współdzielony CalendarDeviceFilterProvider (AppShell), nie przez props tej strony.
  // AGENT: kalendarz tylko do odczytu (bez tworzenia i przesuwania rezerwacji).
  return <CalendarView canEdit={!driverMode && session?.user.role !== "AGENT"} initialDate={date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null} />;
}
