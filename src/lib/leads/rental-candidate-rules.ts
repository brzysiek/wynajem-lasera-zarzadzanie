// Czyste reguły wyszukiwarki „Powiąż z wynajmem” (rental-candidates.ts).

const DAY = 86_400_000;

// „06.11”, „6.11.2026”, „2026-11-06” → data; inaczej tekst do szukania.
export function parseCandidateQuery(q: string, now = new Date()): { date: Date | null; text: string | null } {
  const t = q.trim();
  if (!t) return { date: null, text: null };
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return { date: new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])), text: null };
  const pl = t.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
  if (pl) {
    const year = pl[3] ? Number(pl[3]) : now.getFullYear();
    let d = new Date(year, Number(pl[2]) - 1, Number(pl[1]));
    // Bez roku: data sprzed ponad pół roku → raczej przyszły rok.
    if (!pl[3] && now.getTime() - d.getTime() > 180 * DAY) d = new Date(year + 1, Number(pl[2]) - 1, Number(pl[1]));
    return { date: d, text: null };
  }
  return { date: null, text: t.length >= 2 ? t : null };
}

// Słowa nazwy klienta / osoby do dopasowania po tytule wydarzenia (≥ 4 litery).
export function nameTokens(...names: (string | null | undefined)[]): string[] {
  const stop = new Set(["salon", "gabinet", "studio", "kosmetyczny", "kosmetyczna", "kosmetologia", "beauty", "urody", "clinic", "estetyczna", "estetyczny"]);
  return [
    ...new Set(
      names
        .flatMap((n) => (n ?? "").toLowerCase().split(/[^\p{L}\d]+/u))
        .filter((w) => w.length >= 4 && !stop.has(w)),
    ),
  ].slice(0, 6);
}
