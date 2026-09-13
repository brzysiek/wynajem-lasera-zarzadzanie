// Definicje okresów dla dashboardu przychodów (prompt sekcja 1).
// Serwer aplikacji działa w Europe/Warsaw — daty liczymy po lokalnych
// składowych Date, tak samo jak rentalDurationDays / reszta aplikacji.

export type PeriodMode = "month" | "range" | "season";

export type Period = {
  mode: PeriodMode;
  start: Date; // inclusive, 00:00:00.000
  end: Date; // inclusive, 23:59:59.999
  label: string;
  dayCount: number; // liczba dni kalendarzowych okresu (inclusive)
};

const MONTHS_PL = [
  "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
  "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
];

function dayIndex(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

function dayCountInclusive(start: Date, end: Date): number {
  return dayIndex(end) - dayIndex(start) + 1;
}

function startOfDay(y: number, m: number, d: number): Date {
  return new Date(y, m, d, 0, 0, 0, 0);
}
function endOfDay(y: number, m: number, d: number): Date {
  return new Date(y, m, d, 23, 59, 59, 999);
}

// --- Miesiąc ---
export function monthPeriod(year: number, month1to12: number): Period {
  const m = month1to12 - 1;
  const start = startOfDay(year, m, 1);
  const end = endOfDay(year, m + 1, 0); // dzień 0 kolejnego miesiąca = ostatni dzień tego
  return { mode: "month", start, end, label: `${MONTHS_PL[m]} ${year}`, dayCount: dayCountInclusive(start, end) };
}

export function prevMonthPeriod(p: Period): Period {
  const y = p.start.getFullYear();
  const m = p.start.getMonth(); // 0-11
  return m === 0 ? monthPeriod(y - 1, 12) : monthPeriod(y, m); // m = poprzedni miesiąc (1-based)
}

// Bieżący + następny miesiąc kalendarzowy jako jeden ciągły zakres — używane
// przez powiadomienie o brakujących kwotach wynajmu (src/app/api/rentals/revenue-alerts/route.ts),
// NIE przez sam dashboard przychodów (tam okres wybiera użytkownik). Chodzi o
// to, żeby dało się ocenić preliminowany przychód na najbliższe tygodnie —
// stąd pełne miesiące, nie "N dni do przodu" jak w alertach kalendarza.
export function currentAndNextMonthPeriod(now: Date = new Date()): Period {
  const cur = monthPeriod(now.getFullYear(), now.getMonth() + 1);
  const nextMonth1to12 = now.getMonth() + 2; // 1-based, może wyjść 13
  const next =
    nextMonth1to12 > 12 ? monthPeriod(now.getFullYear() + 1, 1) : monthPeriod(now.getFullYear(), nextMonth1to12);
  return {
    mode: "range",
    start: cur.start,
    end: next.end,
    label: `${cur.label} – ${next.label}`,
    dayCount: cur.dayCount + next.dayCount,
  };
}

// --- Sezon (zawsze wrzesień–sierpień) ---
export function seasonPeriod(startYear: number): Period {
  const start = startOfDay(startYear, 8, 1); // 1 września
  const end = endOfDay(startYear + 1, 7, 31); // 31 sierpnia
  return {
    mode: "season",
    start,
    end,
    label: `Sezon ${startYear}/${startYear + 1}`,
    dayCount: dayCountInclusive(start, end),
  };
}

export function prevSeasonPeriod(p: Period): Period {
  return seasonPeriod(p.start.getFullYear() - 1);
}

// Sezon zawierający daną datę: jeśli miesiąc >= wrzesień → sezon zaczyna się w tym roku,
// inaczej w poprzednim.
export function seasonStartYearFor(date: Date): number {
  return date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
}

// --- Zakres ---
export function rangePeriod(fromISO: string, toISO: string): Period {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const a = new Date(fy, fm - 1, fd);
  const b = new Date(ty, tm - 1, td);
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  const start = startOfDay(lo.getFullYear(), lo.getMonth(), lo.getDate());
  const end = endOfDay(hi.getFullYear(), hi.getMonth(), hi.getDate());
  const fmt = (d: Date) => d.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
  return { mode: "range", start, end, label: `${fmt(start)} – ${fmt(end)}`, dayCount: dayCountInclusive(start, end) };
}

// --- parsowanie / serializacja parametrów URL ---
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Zbuduj Period z parametrów searchParams strony. Domyślnie: bieżący miesiąc.
export function periodFromParams(params: {
  mode?: string;
  m?: string; // "YYYY-MM"
  from?: string; // "YYYY-MM-DD"
  to?: string;
  s?: string; // rok startowy sezonu
}): Period {
  const now = new Date();
  const mode: PeriodMode =
    params.mode === "range" || params.mode === "season" ? params.mode : "month";

  if (mode === "range") {
    const from = params.from ?? isoDate(monthPeriod(now.getFullYear(), now.getMonth() + 1).start);
    const to = params.to ?? isoDate(now);
    return rangePeriod(from, to);
  }
  if (mode === "season") {
    const s = Number(params.s);
    return seasonPeriod(Number.isInteger(s) ? s : seasonStartYearFor(now));
  }
  const mm = /^(\d{4})-(\d{2})$/.exec(params.m ?? "");
  return mm ? monthPeriod(Number(mm[1]), Number(mm[2])) : monthPeriod(now.getFullYear(), now.getMonth() + 1);
}

// Okres porównawczy dla wskaźnika trendu (null dla trybu Zakres).
export function comparisonPeriod(p: Period): Period | null {
  if (p.mode === "month") return prevMonthPeriod(p);
  if (p.mode === "season") return prevSeasonPeriod(p);
  return null;
}

// Krótka etykieta „vs ..." na chipie trendu.
export function comparisonLabel(p: Period): string {
  if (p.mode === "month") {
    const prev = prevMonthPeriod(p);
    return prev.label.split(" ")[0].toLowerCase();
  }
  if (p.mode === "season") return prevSeasonPeriod(p).label.toLowerCase();
  return "";
}
