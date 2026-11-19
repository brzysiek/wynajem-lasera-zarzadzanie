// Wniosek 54, etap 1c: okres w zakładce Marketing — wybór obowiązuje we wszystkich
// podzakładkach (parametr w adresie). Czysty moduł (vitest bez „@/”).

const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" });
export const warsawDay = (d: Date): string => DAY_FMT.format(d); // RRRR-MM-DD

const MS = 86_400_000;
export const addDays = (day: string, n: number): string => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string): number => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / MS) + 1;

// Sezon zaczyna się 1.09 (poprzedni rok, gdy jeszcze nie ma września).
export function seasonStart(today: string): string {
  const y = Number(today.slice(0, 4));
  return today.slice(5) >= "09-01" ? `${y}-09-01` : `${y - 1}-09-01`;
}

export const isDay = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());

export type Preset = "7" | "28" | "90" | "sezon" | "wlasny";
export const PRESETS: Preset[] = ["7", "28", "90", "sezon", "wlasny"];

const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const dmy = (d: string) => `${dm(d)}.${d.slice(0, 4)}`;

export type MarketingPeriod = { preset: Preset; from: string; to: string; label: string; prevFrom: string; prevTo: string };

// Parametry adresu: okres=7|28|90|sezon, albo od=&do= (własny zakres).
export function periodFromParams(sp: { okres?: string | null; od?: string | null; do?: string | null }, defaultPreset: Preset, today: string): MarketingPeriod {
  let preset: Preset = defaultPreset === "wlasny" ? "28" : defaultPreset;
  let from = "";
  let to = today;
  if (isDay(sp.od) || isDay(sp.do)) {
    preset = "wlasny";
    to = isDay(sp.do) ? sp.do : today;
    from = isDay(sp.od) ? sp.od : addDays(to, -27);
    if (from > to) [from, to] = [to, from];
  } else {
    if (sp.okres && (PRESETS as string[]).includes(sp.okres) && sp.okres !== "wlasny") preset = sp.okres as Preset;
    from = preset === "sezon" ? seasonStart(today) : addDays(today, -(Number(preset) - 1));
  }
  const len = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  const label =
    preset === "sezon" ? `Cały sezon · ${dmy(from)}–${dmy(to)}` : preset === "wlasny" ? `${dmy(from)}–${dmy(to)}` : `Ostatnie ${preset} dni · ${dm(from)}–${dmy(to)}`;
  return { preset, from, to, label, prevFrom, prevTo };
}

// Zapytanie adresu zachowujące okres (do linków między podzakładkami).
export function periodQuery(p: Pick<MarketingPeriod, "preset" | "from" | "to">): string {
  return p.preset === "wlasny" ? `od=${p.from}&do=${p.to}` : `okres=${p.preset}`;
}
