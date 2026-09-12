import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { VehiclesPanel } from "@/components/vehicles-panel";

export default async function VehiclesSettingsPage() {
  await requireAdmin();

  const [vehicles, fuelPriceSetting] = await Promise.all([
    prisma.vehicle.findMany({ orderBy: { name: "asc" } }),
    prisma.pricingSetting.findUnique({ where: { key: "fuel_price_per_liter" } }),
  ]);

  return (
    <div>
      <PageHeader
        title="Pojazdy"
        description="Flota do przypisywania przy wynajmach. Koszt paliwa per wynajem liczy się ze spalania pojazdu (poniżej) i jednej, wspólnej ceny paliwa — nie wpisujesz kosztu/km osobno w każdym aucie."
      />
      <VehiclesPanel
        initialVehicles={vehicles.map((v) => ({
          id: v.id,
          name: v.name,
          plateNumber: v.plateNumber,
          fuelConsumptionL100km: v.fuelConsumptionL100km.toString(),
          active: v.active,
        }))}
        fuelPrice={fuelPriceSetting ? fuelPriceSetting.value.toString() : "6.50"}
        fuelPriceUpdatedAt={fuelPriceSetting ? fuelPriceSetting.updatedAt.toISOString() : null}
      />
    </div>
  );
}
