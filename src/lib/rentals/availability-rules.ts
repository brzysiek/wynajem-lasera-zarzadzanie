// Wniosek 29: dostępność urządzenia — kolizje rezerwacji po dniach
// kalendarza (wynajmy całodniowe, endsAt = północ ostatniego dnia), najbliższe
// wolne terminy i terminy serii „co N tyg. do dnia …”. Bez zależności —
// testowane w vitest. Dni liczymy po lokalnych składowych (serwer i biuro:
// Europe/Warsaw), jak rentalDurationDays.

export type Span = { start: number; end: number };

export function dayIdx(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

export function idxToYmd(i: number): string {
  return new Date(i * 86_400_000).toISOString().slice(0, 10);
}

export function ymdToIdx(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function spanOf(startsAt: Date, endsAt: Date): Span {
  const start = dayIdx(startsAt);
  return { start, end: Math.max(start, dayIdx(endsAt)) };
}

export function overlaps(a: Span, b: Span): boolean {
  return a.start <= b.end && b.start <= a.end;
}

// Najbliższe wolne początki (tej samej długości) względem żądanego startu —
// nie wcześniej niż `minStart` (dziś), najwyżej `count`, rosnąco.
export function nearestFreeStarts(busy: Span[], wanted: Span, minStart: number, count = 3, radius = 60): number[] {
  const len = wanted.end - wanted.start;
  const free: number[] = [];
  for (let s = Math.max(minStart, wanted.start - radius); s <= wanted.start + radius; s++) {
    if (s === wanted.start) continue;
    const cand = { start: s, end: s + len };
    if (!busy.some((b) => overlaps(b, cand))) free.push(s);
  }
  return free
    .sort((a, b) => Math.abs(a - wanted.start) - Math.abs(b - wanted.start) || b - a)
    .slice(0, count)
    .sort((a, b) => a - b);
}

// Seria: kolejne terminy co `weeks` tygodni od pierwszego, do dnia `until`
// (włącznie), maks. 60 terminów. Pierwszy termin też na liście.
export function seriesSpans(first: Span, weeks: number, until: number): Span[] {
  if (!(weeks >= 1)) return [first];
  const out: Span[] = [];
  for (let k = 0; k < 60; k++) {
    const shift = k * weeks * 7;
    const s = { start: first.start + shift, end: first.end + shift };
    if (s.start > until) break;
    out.push(s);
  }
  return out;
}
