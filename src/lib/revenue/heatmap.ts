// Mapa cieplna (prompt sekcja 13). Czyste funkcje na znormalizowanych
// wierszach — bez Prismy, liczone po stronie klienta (zmiana metryki / filtra
// urządzeń bez round-tripu do serwera).
import type { RevenueRow } from "@/lib/revenue/aggregate";

export type HeatMetric = "revenue" | "count" | "occupancy";

export const WEEKDAY_SHORT = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"] as const;
export const WEEKDAY_LONG = [
  "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela",
] as const;

export type HeatDay = {
  key: string; // YYYY-MM-DD
  dayNum: number; // dzień miesiąca
  weekday: number; // 0 = poniedziałek … 6 = niedziela
  inPeriod: boolean; // false = komórka dopełnienia (tryb miesiąc)
  value: number; // revenue: zł · count: szt. · occupancy: proporcja 0..1
  level: 0 | 1 | 2 | 3 | 4 | 5; // 0 = brak danych (Y=0)
  occX: number | null; // tylko occupancy
  occY: number | null;
};

export type WeekdayAgg = {
  weekday: number;
  value: number; // suma (revenue/count) albo średnia proporcja (occupancy)
  isBest: boolean;
};

export type Heatmap = {
  gridMode: "month" | "continuous";
  weeks: HeatDay[][]; // wiersze po 7 (Pon–Nd); continuous renderuje kolumnami
  metric: HeatMetric;
  weekdayAgg: WeekdayAgg[];
  bestWeekdayText: string; // np. „Najlepszy dzień tygodnia: piątek (12 500 zł)"
  maxValue: number;
  empty: boolean; // nic nie zaznaczono w filtrze
};

const DAY_MS = 86_400_000;

function parseKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function keyOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}
// 0 = poniedziałek … 6 = niedziela (polski standard).
function weekdayMon0(d: Date): number {
  return (d.getDay() + 6) % 7;
}
function clampLevel(n: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, n)) as 1 | 2 | 3 | 4 | 5;
}

function fmtPln(n: number): string {
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(Math.round(n))} zł`;
}
function rentalsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return "wynajem";
  return mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? "wynajmy" : "wynajmów";
}

export function computeHeatmap(
  rows: RevenueRow[],
  selectedDeviceIds: ReadonlySet<string>,
  period: { mode: "month" | "range" | "season"; start: string; end: string },
  metric: HeatMetric,
): Heatmap {
  const gridMode: "month" | "continuous" = period.mode === "month" ? "month" : "continuous";
  const startKey = period.start;
  const endKey = period.end;
  const Y = selectedDeviceIds.size;

  // Zakres komórek: od poniedziałku tygodnia z period.start do niedzieli
  // tygodnia z period.end.
  const first = parseKey(startKey);
  const last = parseKey(endKey);
  const gridStart = addDays(first, -weekdayMon0(first));
  const gridEnd = addDays(last, 6 - weekdayMon0(last));

  // Wydarzenia po filtrze urządzeń.
  const filtered = rows.filter((r) => selectedDeviceIds.has(r.deviceId));

  // Indeksy pomocnicze.
  const startDayMap = new Map<string, RevenueRow[]>(); // klucz = startDate
  for (const r of filtered) {
    const arr = startDayMap.get(r.startDate) ?? [];
    arr.push(r);
    startDayMap.set(r.startDate, arr);
  }

  const rawDays: HeatDay[] = [];
  for (let cur = new Date(gridStart); cur <= gridEnd; cur = addDays(cur, 1)) {
    const key = keyOf(cur);
    const inPeriod = key >= startKey && key <= endKey;
    let value = 0;
    let occX: number | null = null;
    let occY: number | null = null;

    if (inPeriod && Y > 0) {
      if (metric === "revenue") {
        value = (startDayMap.get(key) ?? []).reduce((s, r) => s + r.totalNet, 0);
      } else if (metric === "count") {
        value = (startDayMap.get(key) ?? []).length;
      } else {
        // occupancy — cały zakres dat wynajmu (WYNAJEM), proporcja X/Y
        const busy = new Set<string>();
        for (const r of filtered) {
          if (r.eventType !== "WYNAJEM") continue;
          if (r.startDate <= key && key <= r.endDate) busy.add(r.deviceId);
        }
        occX = busy.size;
        occY = Y;
        value = Y > 0 ? busy.size / Y : 0;
      }
    }

    rawDays.push({
      key,
      dayNum: cur.getDate(),
      weekday: weekdayMon0(cur),
      inPeriod,
      value,
      level: 0,
      occX,
      occY,
    });
  }

  // Poziom koloru.
  const inPeriodDays = rawDays.filter((d) => d.inPeriod);
  const maxValue = inPeriodDays.reduce((m, d) => Math.max(m, d.value), 0);

  for (const d of rawDays) {
    if (!d.inPeriod || Y === 0) {
      d.level = 0;
      continue;
    }
    if (metric === "occupancy") {
      d.level = clampLevel(Math.ceil(d.value * 5)); // value = proporcja 0..1
    } else {
      d.level = maxValue > 0 ? clampLevel(Math.ceil((d.value / maxValue) * 5)) : 1;
    }
  }

  // Podział na tygodnie po 7.
  const weeks: HeatDay[][] = [];
  for (let i = 0; i < rawDays.length; i += 7) weeks.push(rawDays.slice(i, i + 7));

  // Pasek sum per dzień tygodnia (cały okres).
  const weekdayAgg: WeekdayAgg[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const days = inPeriodDays.filter((d) => d.weekday === wd);
    let value: number;
    if (metric === "occupancy") {
      value = days.length > 0 ? days.reduce((s, d) => s + d.value, 0) / days.length : 0;
    } else {
      value = days.reduce((s, d) => s + d.value, 0);
    }
    weekdayAgg.push({ weekday: wd, value, isBest: false });
  }
  const bestWd = weekdayAgg.reduce((b, w) => (w.value > b.value ? w : b), weekdayAgg[0]);
  if (bestWd.value > 0) bestWd.isBest = true;

  let bestWeekdayText = "";
  if (bestWd.value > 0) {
    const name = WEEKDAY_LONG[bestWd.weekday];
    if (metric === "occupancy") {
      bestWeekdayText = `Najlepszy dzień tygodnia: ${name} (śr. ${Math.round(bestWd.value * 100)}% obłożenia)`;
    } else if (metric === "revenue") {
      bestWeekdayText = `Najlepszy dzień tygodnia: ${name} (${fmtPln(bestWd.value)})`;
    } else {
      const n = Math.round(bestWd.value);
      bestWeekdayText = `Najlepszy dzień tygodnia: ${name} (${n} ${rentalsWord(n)})`;
    }
  }

  return {
    gridMode,
    weeks,
    metric,
    weekdayAgg,
    bestWeekdayText,
    maxValue,
    empty: Y === 0,
  };
}
