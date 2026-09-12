import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { CostCategoriesPanel } from "@/components/cost-categories-panel";

export default async function CostCategoriesSettingsPage() {
  await requireAdmin();

  const categories = await prisma.costCategory.findMany({
    orderBy: [{ scope: "asc" }, { name: "asc" }],
    include: { _count: { select: { costs: true } } },
  });

  return (
    <div>
      <PageHeader
        title="Kategorie kosztów"
        description="Dezaktywacja zamiast usuwania — nieaktywna kategoria znika z formularza „Dodaj koszt”, ale istniejące wpisy zostają nienaruszone."
      />
      <CostCategoriesPanel
        initialCategories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          scope: c.scope,
          active: c.active,
          usageCount: c._count.costs,
        }))}
      />
    </div>
  );
}
