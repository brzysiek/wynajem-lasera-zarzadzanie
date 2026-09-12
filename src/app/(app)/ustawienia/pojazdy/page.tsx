import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { VehiclesPanel } from "@/components/vehicles-panel";

export default async function VehiclesSettingsPage() {
  await requireAdmin();

  const vehicles = await prisma.vehicle.findMany({ orderBy: { name: "asc" } });

  return (
    <div>
      <PageHeader
        title="Pojazdy"
        description="Flota do przypisywania przy wynajmach — koszt paliwa/km wpisywany ręcznie (nie ma dostępnego darmowego API cen paliw), używany do wyliczenia kosztu paliwa per wynajem."
      />
      <VehiclesPanel
        initialVehicles={vehicles.map((v) => ({
          id: v.id,
          name: v.name,
          plateNumber: v.plateNumber,
          fuelCostPerKm: v.fuelCostPerKm.toString(),
          fuelCostUpdatedAt: v.fuelCostUpdatedAt ? v.fuelCostUpdatedAt.toISOString() : null,
          active: v.active,
        }))}
      />
    </div>
  );
}
