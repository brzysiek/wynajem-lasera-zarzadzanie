// Agregacje dashboardu przychodów (prompt sekcje 2–10). Czyste funkcje na
// znormalizowanych wierszach — bez Prismy, żeby dało się użyć po stronie
// klienta (przełączanie zakładek bez round-tripu).

export type RevenueEventType = "WYNAJEM" | "SZKOLENIE";
export type RevenuePaymentMethod = "CASH" | "TRANSFER";

// Jeden wiersz = jedno wydarzenie z RentalFinance w okresie (sekcja 2).
export type RevenueRow = {
  id: string;
  eventType: RevenueEventType;
  deviceId: string;
  deviceName: string;
  startsAt: string; // ISO
  durationDays: number; // rentalDurationDays, inclusive
  totalNet: number; // RentalFinance.totalNet (netto, bez VAT)
  paymentMethod: RevenuePaymentMethod;
  pulsePending: boolean; // pulseCalculationStatus === "PENDING"
  hubspotContactId: string | null;
  contactLabel: string | null; // contactCompanyCache || contactNameCache
};

// Wiersz „Szkolenia" w tabeli urządzeń dostaje ten sztuczny id (sekcja 2).
export const TRAINING_BUCKET_ID = "__training__";

export function round(n: number): number {
  return Math.round(n);
}

// --- KPI (sekcja 3) ---
export type Kpis = {
  revenueNet: number;
  rentalCount: number;
  trainingCount: number;
  avgValue: number | null; // null gdy rentalCount === 0
  uniqueClients: number;
};

export function computeKpis(rows: RevenueRow[]): Kpis {
  const revenueNet = rows.reduce((s, r) => s + r.totalNet, 0);
  const rentalCount = rows.length;
  const trainingCount = rows.filter((r) => r.eventType === "SZKOLENIE").length;
  const clientIds = new Set<string>();
  for (const r of rows) if (r.hubspotContactId) clientIds.add(r.hubspotContactId);
  return {
    revenueNet,
    rentalCount,
    trainingCount,
    avgValue: rentalCount === 0 ? null : revenueNet / rentalCount,
    uniqueClients: clientIds.size,
  };
}

// --- wskaźnik trendu (sekcja 4) ---
// null = brak sensownego porównania (poprzedni okres = 0 lub tryb Zakres).
export function trendPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return round(((current - previous) / previous) * 100);
}

// --- tabela urządzeń + wykorzystanie (sekcje 5, 7) ---
export type DeviceRow = {
  id: string; // deviceId lub TRAINING_BUCKET_ID
  name: string;
  isTraining: boolean;
  revenueNet: number;
  sharePct: number; // udział w przychodzie całego okresu
  rentalCount: number;
  avgValue: number;
  utilizationPct: number | null; // null dla „Szkolenia"
};

export function computeDeviceBreakdown(rows: RevenueRow[], periodDayCount: number): DeviceRow[] {
  const totalRevenue = rows.reduce((s, r) => s + r.totalNet, 0);

  // Urządzenia (WYNAJEM) grupowane po deviceId.
  const byDevice = new Map<string, { name: string; revenue: number; count: number; rentedDays: number }>();
  let trainingRevenue = 0;
  let trainingCount = 0;

  for (const r of rows) {
    if (r.eventType === "SZKOLENIE") {
      trainingRevenue += r.totalNet;
      trainingCount += 1;
      continue;
    }
    const cur = byDevice.get(r.deviceId) ?? { name: r.deviceName, revenue: 0, count: 0, rentedDays: 0 };
    cur.revenue += r.totalNet;
    cur.count += 1;
    cur.rentedDays += r.durationDays;
    byDevice.set(r.deviceId, cur);
  }

  const deviceRows: DeviceRow[] = [...byDevice.entries()].map(([id, d]) => ({
    id,
    name: d.name,
    isTraining: false,
    revenueNet: d.revenue,
    sharePct: totalRevenue > 0 ? round((d.revenue / totalRevenue) * 100) : 0,
    rentalCount: d.count,
    avgValue: d.revenue / d.count,
    utilizationPct: Math.min(100, round((d.rentedDays / periodDayCount) * 100)),
  }));

  deviceRows.sort((a, b) => b.revenueNet - a.revenueNet);

  if (trainingCount > 0) {
    deviceRows.push({
      id: TRAINING_BUCKET_ID,
      name: "Szkolenia",
      isTraining: true,
      revenueNet: trainingRevenue,
      sharePct: totalRevenue > 0 ? round((trainingRevenue / totalRevenue) * 100) : 0,
      rentalCount: trainingCount,
      avgValue: trainingRevenue / trainingCount,
      utilizationPct: null,
    });
  }

  return deviceRows;
}

// --- insight best/worst wykorzystania (sekcja 6) ---
// null gdy < 2 urządzeń (nie-szkolenia) z przychodem w okresie.
export function bestWorstUtilization(
  deviceRows: DeviceRow[],
): { best: DeviceRow; worst: DeviceRow } | null {
  const real = deviceRows.filter((d) => !d.isTraining && d.utilizationPct != null);
  if (real.length < 2) return null;
  const sorted = [...real].sort((a, b) => (b.utilizationPct ?? 0) - (a.utilizationPct ?? 0));
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

// --- rozkład długości wynajmu (sekcja 8) — tylko WYNAJEM, kategorie 1/2/3 dni ---
export type DurationBucket = { days: 1 | 2 | 3; count: number; pct: number };

export function computeDurationHistogram(rows: RevenueRow[]): DurationBucket[] {
  const counts: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  let total = 0;
  for (const r of rows) {
    if (r.eventType !== "WYNAJEM") continue;
    total += 1;
    const bucket = (r.durationDays <= 1 ? 1 : r.durationDays === 2 ? 2 : 3) as 1 | 2 | 3;
    counts[bucket] += 1;
  }
  return ([1, 2, 3] as const).map((days) => ({
    days,
    count: counts[days],
    pct: total > 0 ? round((counts[days] / total) * 100) : 0,
  }));
}

// --- sposób płatności (sekcja 9) — WYNAJEM + SZKOLENIE razem ---
export type PaymentSplit = { method: RevenuePaymentMethod; sum: number; pct: number }[];

export function computePaymentSplit(rows: RevenueRow[]): PaymentSplit {
  const sums: Record<RevenuePaymentMethod, number> = { CASH: 0, TRANSFER: 0 };
  for (const r of rows) sums[r.paymentMethod] += r.totalNet;
  const total = sums.CASH + sums.TRANSFER;
  return (["CASH", "TRANSFER"] as const).map((method) => ({
    method,
    sum: sums[method],
    pct: total > 0 ? round((sums[method] / total) * 100) : 0,
  }));
}

// --- sygnalizacja niepewnych cen (sekcja 10) ---
export function pendingPriceCount(rows: RevenueRow[]): number {
  return rows.filter((r) => r.pulsePending).length;
}
