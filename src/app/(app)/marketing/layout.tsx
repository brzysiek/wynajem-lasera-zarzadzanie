import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth-guards";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { waitingProposals } from "@/lib/marketing/analysis";
import { warsawDay } from "@/lib/marketing/period";

// Marketing (wniosek 54, etap 1c): wspólny nagłówek, podzakładki i selektor okresu.
// Tylko ADMIN. Plakietka przy „Analiza” = propozycje o statusie „czeka” (0 = bez plakietki).
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const waiting = await waitingProposals();
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">Marketing</h1>
        <p className="mt-1 text-sm text-gray-500">Skąd przychodzą klienci i co z tego mamy</p>
      </div>
      <Suspense fallback={null}>
        <MarketingChrome today={warsawDay(new Date())} waiting={waiting} />
      </Suspense>
      {children}
    </div>
  );
}
