import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { isoDate, monthPeriod } from "@/lib/revenue/period";
import { CostEntriesManager } from "@/components/cost-entries-manager";

// "Wpisy kosztów" — trzecia podpozycja Finansów. WŁASNY, niezależny filtr
// okresu (docs/prompt-claude-code-dashboard-kosztow.md sekcja 5) — nie
// uczestniczy we wspólnym stanie Przychody↔Koszty.
export default async function CostEntriesPage() {
  await requireAdmin();

  const now = new Date();
  const period = monthPeriod(now.getFullYear(), now.getMonth() + 1);

  const [categories, vehicles, devices] = await Promise.all([
    prisma.costCategory.findMany({
      where: { active: true },
      orderBy: [{ scope: "asc" }, { name: "asc" }],
      select: { id: true, name: true, scope: true },
    }),
    prisma.vehicle.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.device.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <CostEntriesManager
      initialFrom={isoDate(period.start)}
      initialTo={isoDate(period.end)}
      categories={categories}
      vehicles={vehicles}
      devices={devices}
    />
  );
}
