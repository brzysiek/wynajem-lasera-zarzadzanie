import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CalendarView } from "@/components/calendar-view";

export default async function CalendarPage() {
  const session = await auth();
  const devices = await prisma.device.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, shortName: true, color: true, active: true, googleCalendarId: true },
  });

  return <CalendarView devices={devices} canEdit={session?.user.role !== "KIEROWCA"} />;
}
