import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { VIEW_COOKIE, actsAsDriver } from "@/lib/effective-role";
import { CalendarView } from "@/components/calendar-view";

export default async function CalendarPage() {
  const session = await auth();
  const viewCookie = (await cookies()).get(VIEW_COOKIE)?.value;
  const driverMode = actsAsDriver(session?.user.role, session?.user.canActAsDriver, viewCookie);

  const devices = await prisma.device.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, shortName: true, color: true, active: true, googleCalendarId: true },
  });

  return <CalendarView devices={devices} canEdit={!driverMode} />;
}
