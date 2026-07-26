import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { CalendarView } from "@/components/calendar-view";

export default async function CalendarPage() {
  const devices = await prisma.device.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, shortName: true, color: true, active: true, googleCalendarId: true },
  });

  return (
    <div>
      <PageHeader
        title="Kalendarz"
        description="Widok miesięczny/tygodniowy wynajmów z filtrem urządzeń."
      />
      <CalendarView devices={devices} />
    </div>
  );
}
