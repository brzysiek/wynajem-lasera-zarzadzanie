// Pola liczone karty klienta (prompt karta-klienta, sekcja 4): rytm, dzień
// tygodnia, urządzenie i głowice, przerwa sezonowa, prognoza terminów,
// ryzyko odejścia i siatka „Rytm współpracy” (lata × miesiące). Bez nowych
// danych — tylko z wynajmów (panel + historia z kalendarzy). Czysty moduł
// (vitest bez aliasu "@/"). Daty liczone w strefie Europe/Warsaw.

export type RhythmRental = { at: Date; device: string | null; heads: number | null };

export type DeviceConfig = {
  family: string; // „LightSheer”
  heads: number | null; // najczęstsza liczba głowic (gdy znana)
  always: boolean; // każdy wynajem ze znaną liczbą głowic ma tyle samo
  models: { name: string; count: number }[]; // „Quattro” 15×, „Desire” 14×
};

export type ChurnRisk = { level: "niskie" | "średnie" | "wysokie"; ratio: number; lastAt: Date };

export type RhythmCell = { realized: number; planned: number; proposed: number };

export type ClientRhythm = {
  rhythmDays: number | null;
  preferredWeekday: { day: number; count: number; total: number; share: number } | null;
  deviceConfig: DeviceConfig | null;
  seasonalBreak: number[]; // miesiące 1–12
  forecast: Date[];
  churnRisk: ChurnRisk | null;
  grid: { year: number; months: RhythmCell[] }[];
};

const DAY = 86_400_000;
const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" });

// Dzień w Warszawie jako data UTC 12:00 — dalsze rachunki bez stref i DST.
export function warsawDay(d: Date): Date {
  const [y, m, day] = ymdFmt.format(d).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, 12));
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const monthOf = (d: Date) => d.getUTCMonth() + 1;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Mediana odstępów między zrealizowanymi wynajmami, bez przerw dłuższych
// niż 2,5× mediana (wakacje, zima). Od 3 wynajmów.
export function rhythmDays(dates: Date[]): number | null {
  if (dates.length < 3) return null;
  const days = [...dates].map(warsawDay).sort((a, b) => a.getTime() - b.getTime());
  const gaps = days
    .slice(1)
    .map((d, i) => Math.round((d.getTime() - days[i].getTime()) / DAY))
    .filter((g) => g > 0);
  if (gaps.length < 2) return null;
  const m = median(gaps);
  const kept = gaps.filter((g) => g <= 2.5 * m);
  return Math.round(median(kept.length ? kept : gaps));
}

export function preferredWeekday(dates: Date[]): ClientRhythm["preferredWeekday"] {
  if (dates.length < 3) return null;
  const counts = new Array(7).fill(0) as number[];
  for (const d of dates) counts[warsawDay(d).getUTCDay()]++;
  const day = counts.indexOf(Math.max(...counts));
  return { day, count: counts[day], total: dates.length, share: counts[day] / dates.length };
}

// „LightSheer Quattro” → rodzina „LightSheer”, model „Quattro”.
function splitDevice(name: string): { family: string; model: string } {
  const [family, ...rest] = name.trim().split(/\s+/);
  return { family, model: rest.join(" ") || family };
}

export function deviceConfig(rentals: RhythmRental[]): DeviceConfig | null {
  const withDevice = rentals.filter((r): r is RhythmRental & { device: string } => !!r.device?.trim());
  if (!withDevice.length) return null;
  const byFamily = new Map<string, RhythmRental[]>();
  for (const r of withDevice) {
    const f = splitDevice(r.device).family;
    byFamily.set(f, [...(byFamily.get(f) ?? []), r]);
  }
  const [family, list] = [...byFamily.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const models = new Map<string, number>();
  for (const r of list) {
    const m = splitDevice(r.device!).model;
    models.set(m, (models.get(m) ?? 0) + 1);
  }
  const heads = list.map((r) => r.heads).filter((h): h is number => h != null);
  const headCounts = new Map<number, number>();
  for (const h of heads) headCounts.set(h, (headCounts.get(h) ?? 0) + 1);
  const top = [...headCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    family,
    heads: top ? top[0] : null,
    always: !!top && headCounts.size === 1 && heads.length * 2 >= list.length,
    models: [...models.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  };
}

// Liczba głowic z opisu wydarzenia w kalendarzu („2 głowice”, „podwójna”).
export function headsFromText(text: string | null | undefined): number | null {
  const t = (text ?? "").toLowerCase();
  if (!t) return null;
  if (/(\b2|dwie)\s*g[łl]owic|podw[óo]jn|\bdouble\b|2\s*x\s*g[łl]owic/.test(t)) return 2;
  if (/(\b1|jedna)\s*g[łl]owic|pojedyncz|\bsingle\b/.test(t)) return 1;
  return null;
}

// Miesiące bez wynajmu w ≥ 2 kolejnych latach, gdy sąsiednie miesiące
// (przed i po przerwie, maks. 3 miesiące) mają wynajmy.
export function seasonalBreak(dates: Date[]): number[] {
  if (dates.length < 6) return [];
  const idx = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
  const filled = new Set(dates.map((d) => idx(warsawDay(d))));
  const all = [...filled].sort((a, b) => a - b);
  const years = new Map<number, Set<number>>(); // miesiąc 1–12 → lata z przerwą
  for (let i = 1; i < all.length; i++) {
    const gap = all[i] - all[i - 1] - 1;
    if (gap < 1 || gap > 3) continue;
    for (let k = all[i - 1] + 1; k < all[i]; k++) {
      const month = (k % 12) + 1;
      years.set(month, (years.get(month) ?? new Set()).add(Math.floor(k / 12)));
    }
  }
  const out: number[] = [];
  for (const [month, ys] of years) {
    const sorted = [...ys].sort((a, b) => a - b);
    if (sorted.some((y, i) => i > 0 && y - sorted[i - 1] === 1)) out.push(month);
  }
  return out.sort((a, b) => a - b);
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
export function monthsLabel(months: number[]): string {
  if (!months.length) return "";
  const runs: number[][] = [];
  for (const m of months) {
    const last = runs[runs.length - 1];
    if (last && m === last[last.length - 1] + 1) last.push(m);
    else runs.push([m]);
  }
  return runs.map((r) => (r.length === 1 ? ROMAN[r[0] - 1] : `${ROMAN[r[0] - 1]}–${ROMAN[r[r.length - 1] - 1]}`)).join(", ");
}

// Wielkanoc (algorytm Meeusa/Jonesa/Butchera) — do świąt ruchomych.
function easter(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day, 12));
}

// Dni wolne w Polsce + okres 24–31.12 (gabinety zwykle nie pracują).
export function isHoliday(d: Date): boolean {
  const m = monthOf(d);
  const day = d.getUTCDate();
  if (m === 12 && day >= 24) return true;
  const fixed = ["1-1", "1-6", "5-1", "5-3", "8-15", "11-1", "11-11"];
  if (fixed.includes(`${m}-${day}`)) return true;
  const e = easter(d.getUTCFullYear());
  const t = d.getTime();
  return [1, 60].some((n) => Math.abs(addDays(e, n).getTime() - t) < DAY / 2); // poniedziałek wielkanocny, Boże Ciało
}

export function forecastDates(input: {
  lastPlanned: Date | null;
  lastRealized: Date | null;
  rhythm: number | null;
  weekday: number | null; // gdy przeważa (≥ 50%)
  breakMonths: number[];
  today: Date;
}): Date[] {
  const { rhythm } = input;
  const base0 = input.lastPlanned ?? input.lastRealized;
  if (!rhythm || !base0 || rhythm > 120) return [];
  const today = warsawDay(input.today);
  const base = warsawDay(base0);
  const endYear = monthOf(base) === 12 ? base.getUTCFullYear() + 1 : base.getUTCFullYear();
  const out: Date[] = [];
  let cursor = base;
  for (let guard = 0; guard < 40 && out.length < 6; guard++) {
    cursor = addDays(cursor, rhythm);
    let d = cursor;
    if (input.weekday != null) {
      let diff = (input.weekday - d.getUTCDay() + 7) % 7;
      if (diff > 3) diff -= 7;
      d = addDays(d, diff);
      cursor = d;
    }
    if (input.breakMonths.includes(monthOf(d))) continue;
    let shifted = d;
    while (isHoliday(shifted)) shifted = addDays(shifted, -7); // 25.12 → 18.12
    if (shifted <= today) continue;
    if (shifted.getUTCFullYear() > endYear && out.length >= 2) break;
    if (out.length && shifted.getTime() <= out[out.length - 1].getTime()) continue;
    out.push(shifted);
    if (shifted.getUTCFullYear() >= endYear && monthOf(shifted) === 12 && out.length >= 2) break;
  }
  return out;
}

export function churnRisk(lastAt: Date | null, rhythm: number | null, today: Date): ChurnRisk | null {
  if (!lastAt || !rhythm) return null;
  const ratio = Math.max(0, (warsawDay(today).getTime() - warsawDay(lastAt).getTime()) / DAY) / rhythm;
  return { level: ratio < 1.2 ? "niskie" : ratio <= 2 ? "średnie" : "wysokie", ratio: Math.round(ratio * 100) / 100, lastAt };
}

export function computeRhythm(input: { realized: RhythmRental[]; planned: RhythmRental[]; today: Date }): ClientRhythm {
  const realizedDates = input.realized.map((r) => r.at);
  const rhythm = rhythmDays(realizedDates);
  const weekday = preferredWeekday(realizedDates);
  const breakMonths = seasonalBreak(realizedDates);
  const sortedPlanned = [...input.planned].sort((a, b) => a.at.getTime() - b.at.getTime());
  const lastPlanned = sortedPlanned[sortedPlanned.length - 1]?.at ?? null;
  const lastRealized = realizedDates.length ? new Date(Math.max(...realizedDates.map((d) => d.getTime()))) : null;
  const forecast = forecastDates({
    lastPlanned,
    lastRealized,
    rhythm,
    weekday: weekday && weekday.share >= 0.5 ? weekday.day : null,
    breakMonths,
    today: input.today,
  });

  const cells = new Map<number, RhythmCell[]>();
  const cell = (d: Date) => {
    const w = warsawDay(d);
    const y = w.getUTCFullYear();
    if (!cells.has(y)) cells.set(y, Array.from({ length: 12 }, () => ({ realized: 0, planned: 0, proposed: 0 })));
    return cells.get(y)![w.getUTCMonth()];
  };
  for (const d of realizedDates) cell(d).realized++;
  for (const r of input.planned) cell(r.at).planned++;
  for (const d of forecast) cell(d).proposed++;
  const years = [...cells.keys()].sort((a, b) => a - b);
  const grid = years.length ? Array.from({ length: years[years.length - 1] - years[0] + 1 }, (_, i) => years[0] + i) : [];

  return {
    rhythmDays: rhythm,
    preferredWeekday: weekday,
    deviceConfig: deviceConfig([...input.realized, ...input.planned]),
    seasonalBreak: breakMonths,
    forecast,
    churnRisk: churnRisk(lastPlanned ?? lastRealized, rhythm, input.today),
    grid: grid.map((year) => ({ year, months: cells.get(year) ?? Array.from({ length: 12 }, () => ({ realized: 0, planned: 0, proposed: 0 })) })),
  };
}

// Kompletność: wypełnione pola / pola oczekiwane dla statusu klienta.
export function completeness(filled: Record<string, boolean>, expected: string[]): { percent: number; missing: string[] } {
  if (!expected.length) return { percent: 100, missing: [] };
  const missing = expected.filter((k) => !filled[k]);
  return { percent: Math.round(((expected.length - missing.length) / expected.length) * 100), missing };
}
