import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { PricingPanel } from "@/components/pricing-panel";

export default async function PricingSettingsPage() {
  await requireAdmin();

  const [priceRules, pulseTiers, settings] = await Promise.all([
    prisma.priceRule.findMany({
      orderBy: [{ pricingCategory: "asc" }, { variant: "asc" }, { durationDays: "asc" }],
    }),
    prisma.pulseTier.findMany({ orderBy: [{ durationDays: "asc" }, { order: "asc" }] }),
    prisma.pricingSetting.findMany({ orderBy: { key: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader
        title="Cennik"
        description="Ceny wynajmu, progi impulsów LightSheer i pojedyncze stawki modułu finansowego. Zmiany działają od kolejnego liczenia — nie zmieniają wstecz już zapisanych rozliczeń."
      />
      <PricingPanel
        initialPriceRules={priceRules.map((r) => ({
          id: r.id,
          pricingCategory: r.pricingCategory,
          variant: r.variant,
          durationDays: r.durationDays,
          priceNet: r.priceNet.toString(),
        }))}
        initialPulseTiers={pulseTiers.map((t) => ({
          id: t.id,
          durationDays: t.durationDays,
          order: t.order,
          maxPulses: t.maxPulses,
          priceNet: t.priceNet.toString(),
          isOverflowTier: t.isOverflowTier,
          overflowStepPulses: t.overflowStepPulses,
          overflowStepPriceNet: t.overflowStepPriceNet ? t.overflowStepPriceNet.toString() : null,
        }))}
        initialSettings={settings.map((s) => ({ key: s.key, value: s.value.toString() }))}
      />
    </div>
  );
}
