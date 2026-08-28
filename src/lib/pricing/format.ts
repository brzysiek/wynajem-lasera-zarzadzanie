import { Prisma } from "./types";

// "1720" -> "1 720 zł", "1720.5" -> "1 720,50 zł". Grupowanie pl-PL używa
// spacji nierozdzielającej. Grosze pokazujemy tylko gdy niezerowe.
export function formatPln(amount: Prisma.Decimal | number | string): string {
  const n = amount instanceof Prisma.Decimal ? amount.toNumber() : Number(amount);
  if (!Number.isFinite(n)) return "—";
  const hasFraction = Math.abs(n - Math.trunc(n)) > 1e-9;
  const formatted = new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(n);
  return `${formatted} zł`;
}
