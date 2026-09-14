import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { isoDate, monthPeriod } from "@/lib/revenue/period";
import { FuelInvoicesManager } from "@/components/fuel-invoices-manager";

// Czwarta podpozycja Finansów — weryfikacja szacowanego kosztu paliwa
// (wzór w src/lib/costs/calc.ts) z rzeczywistymi fakturami. WŁASNY,
// niezależny filtr okresu, jak "Wpisy kosztów" (nie współdzielony ze
// stanem Przychody↔Koszty).
export default async function FuelInvoicesPage() {
  await requireAdmin();

  const now = new Date();
  const period = monthPeriod(now.getFullYear(), now.getMonth() + 1);

  const vehicles = await prisma.vehicle.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return <FuelInvoicesManager initialFrom={isoDate(period.start)} initialTo={isoDate(period.end)} vehicles={vehicles} />;
}
