import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { UpcomingRentalsView } from "@/components/upcoming-rentals-view";

export default async function UpcomingPage() {
  const devices = await prisma.device.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, shortName: true, color: true, active: true },
  });

  return (
    <div>
      <PageHeader
        title="Nadchodzące"
        description="Lista nadchodzących wynajmów wymagających uwagi."
      />
      <UpcomingRentalsView devices={devices} />
    </div>
  );
}
