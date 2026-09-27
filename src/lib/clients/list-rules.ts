// Reguły nowej listy klientów (prompt „lista klientów”, 27.09.2026): pętla
// półroczy „Przed sezonem” (pkt 4), pasek rytmu 12 + 3 miesiące (pkt 2) i
// ostrzeżenie „do sprawdzenia”, gdy status przeczy historii (wniosek 12).
// Czysty moduł (vitest bez aliasu "@/"). Daty — lokalne składowe (serwer
// działa w Europe/Warsaw, jak status.ts).
import { computeClientStatus, type ClientStatus } from "./status";

const DAY = 86_400_000;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

// ---------- Przed sezonem ----------

export type SeasonWindow = {
  baseFrom: Date;
  baseTo: Date; // wyłącznie
  seasonFrom: Date;
  seasonTo: Date; // wyłącznie
  label: string; // „jesień 2026”
  baseLabel: string; // „I–VIII 2026”
  seasonLabel: string; // „IX–XII”
  baseMonths: number[]; // 1–12, do mini-roku
  seasonMonths: number[];
  flip: string; // zdanie o odwróceniu pętli
};

// IX–XII: baza = I–VIII bieżącego roku, sezon = IX–XII („jesień”).
// I–VIII: baza = IX–XII poprzedniego roku, sezon = I–VIII („wiosna”).
export function seasonWindow(today: Date): SeasonWindow {
  const y = today.getFullYear();
  const spring = [1, 2, 3, 4, 5, 6, 7, 8];
  const autumn = [9, 10, 11, 12];
  if (today.getMonth() >= 8) {
    return {
      baseFrom: new Date(y, 0, 1),
      baseTo: new Date(y, 8, 1),
      seasonFrom: new Date(y, 8, 1),
      seasonTo: new Date(y + 1, 0, 1),
      label: `jesień ${y}`,
      baseLabel: `I–VIII ${y}`,
      seasonLabel: "IX–XII",
      baseMonths: spring,
      seasonMonths: autumn,
      flip: `Od 1 stycznia pętla się odwraca: klientki z IX–XII ${y} bez rezerwacji na I–VIII ${y + 1} („przed wiosną”).`,
    };
  }
  return {
    baseFrom: new Date(y - 1, 8, 1),
    baseTo: new Date(y, 0, 1),
    seasonFrom: new Date(y, 0, 1),
    seasonTo: new Date(y, 8, 1),
    label: `wiosna ${y}`,
    baseLabel: `IX–XII ${y - 1}`,
    seasonLabel: "I–VIII",
    baseMonths: autumn,
    seasonMonths: spring,
    flip: `Od 1 września pętla się odwraca: klientki z I–VIII ${y} bez rezerwacji na IX–XII ${y} („przed jesienią”).`,
  };
}

// Klientka „przed sezonem”: nie potencjalna, nie „Nie kontaktować”, ≥ 1
// wynajem w okresie bazowym, 0 wynajmów i 0 rezerwacji w sezonie; pomijana,
// dopóki trwa jej przerwa sezonowa (np. VII–VIII).
export function isBeforeSeason(input: {
  status: ClientStatus;
  rentalDates: Date[]; // zrealizowane wynajmy
  bookedDates: Date[]; // wszystkie nieusunięte wynajmy i rezerwacje (także przyszłe)
  seasonalBreak: number[];
  window: SeasonWindow;
  today: Date;
}): boolean {
  const w = input.window;
  if (input.status === "POTENCJALNY" || input.status === "NIE_KONTAKTOWAC") return false;
  if (input.seasonalBreak.includes(input.today.getMonth() + 1)) return false;
  const inBase = input.rentalDates.some((d) => d >= w.baseFrom && d < w.baseTo);
  const inSeason = [...input.rentalDates, ...input.bookedDates].some((d) => d >= w.seasonFrom && d < w.seasonTo);
  return inBase && !inSeason;
}

// ---------- Pasek rytmu ----------

// R = był wynajem, P = rezerwacja, F = wg rytmu powinna wynająć, a nie ma
// rezerwacji, E = brak.
export type StripCell = "R" | "P" | "F" | "E";

export type RhythmStrip = {
  cells: StripCell[]; // 12 (ostatnie miesiące, z bieżącym) + 3 (najbliższe)
  months: { month: number; year: number }[];
  pastLabel: string; // „X.25–IX.26”
  futureLabel: string; // „X–XII”
  // Proponowany termin dla pierwszego miesiąca „F” (do okna ⓘ).
  suggestion: { month: number; at: Date } | null;
};

const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();

// Miesiące oczekiwane wg rytmu: przy rytmie do ~5 tygodni każdy miesiąc
// poza przerwą; przy dłuższym — daty z prognozy karty (po ostatniej
// rezerwacji) i luki między terminami dłuższe niż 1,5× rytm.
export function rhythmStrip(input: {
  realized: Date[];
  planned: Date[];
  forecast: Date[];
  rhythmDays: number | null;
  seasonalBreak: number[];
  today: Date;
}): RhythmStrip {
  const now = monthIndex(input.today);
  const months = Array.from({ length: 15 }, (_, i) => {
    const idx = now - 11 + i;
    return { month: (idx % 12) + 1, year: Math.floor(idx / 12) };
  });
  const realized = new Set(input.realized.map(monthIndex));
  const planned = new Set(input.planned.map(monthIndex));
  const expected = new Map<number, Date>();
  const r = input.rhythmDays;
  if (r && r <= 120) {
    const anchors = [...input.realized.filter((d) => d <= input.today), ...input.planned].sort((a, b) => a.getTime() - b.getTime());
    const last = anchors[anchors.length - 1];
    // Ponad rok bez wynajmu (Była) — rytm już nic nie podpowiada.
    const stale = !last || input.today.getTime() - last.getTime() > 365 * DAY;
    if (stale) {
      // brak oczekiwanych miesięcy
    } else if (r <= 35) {
      // Klientka „co miesiąc”: każdy miesiąc bez rezerwacji to okazja.
      for (let k = 1; k <= 3; k++) {
        const prev = anchors.filter((a) => monthIndex(a) < now + k).pop() ?? last;
        let d = new Date(prev.getTime() + r * DAY);
        while (monthIndex(d) < now + k) d = new Date(d.getTime() + r * DAY);
        expected.set(now + k, monthIndex(d) === now + k ? d : new Date(input.today.getFullYear(), input.today.getMonth() + k, 15));
      }
    } else {
      for (const d of input.forecast) if (!expected.has(monthIndex(d))) expected.set(monthIndex(d), d);
      for (let i = 1; i < anchors.length; i++) {
        const a = anchors[i - 1];
        const b = anchors[i];
        if (b.getTime() - a.getTime() <= 1.5 * r * DAY) continue;
        for (let t = a.getTime() + r * DAY; t < b.getTime() - 0.5 * r * DAY; t += r * DAY) {
          const d = new Date(t);
          if (!expected.has(monthIndex(d))) expected.set(monthIndex(d), d);
        }
      }
    }
  }
  let suggestion: RhythmStrip["suggestion"] = null;
  const cells = months.map((m, i): StripCell => {
    const idx = now - 11 + i;
    if (i < 12) {
      if (realized.has(idx)) return "R";
      return planned.has(idx) ? "P" : "E";
    }
    if (planned.has(idx)) return "P";
    const exp = expected.get(idx);
    if (exp && !input.seasonalBreak.includes(m.month) && exp > input.today) {
      if (!suggestion) suggestion = { month: m.month, at: exp };
      return "F";
    }
    return "E";
  });
  const first = months[0];
  const cur = months[11];
  return {
    cells,
    months,
    pastLabel: `${ROMAN[first.month - 1]}.${String(first.year).slice(2)}–${ROMAN[cur.month - 1]}.${String(cur.year).slice(2)}`,
    futureLabel: `${ROMAN[months[12].month - 1]}–${ROMAN[months[14].month - 1]}`,
    suggestion,
  };
}

// ---------- Do sprawdzenia ----------

const RANK: Record<ClientStatus, number> = { POTENCJALNY: 0, BYLY: 1, USPIONY: 2, NOWY: 3, STALY: 4, NIE_KONTAKTOWAC: -1 };
const STATUS_WORD: Record<ClientStatus, string> = {
  POTENCJALNY: "Potencjalny",
  NOWY: "Nowy",
  STALY: "Stały",
  USPIONY: "Uśpiony",
  BYLY: "Były",
  NIE_KONTAKTOWAC: "Nie kontaktować",
};

const dm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;

// Status przeczy historii: „Nie kontaktować” z rezerwacją albo wynajmy,
// których kierowca jeszcze nie potwierdził, a które podniosłyby status.
export function statusCheck(input: {
  status: ClientStatus;
  realizedDates: Date[];
  unconfirmedPast: Date[]; // odbyte (po terminie), bez potwierdzenia odbioru
  nextReservation: Date | null;
  today: Date;
}): string | null {
  if (input.status === "NIE_KONTAKTOWAC") {
    return input.nextReservation ? `„Nie kontaktować”, a ma rezerwację ${dm(input.nextReservation)}` : null;
  }
  if (input.unconfirmedPast.length === 0) return null;
  const alt = computeClientStatus({
    statusOverride: null,
    realizedRentalDates: [...input.realizedDates, ...input.unconfirmedPast],
    today: input.today,
    hasFutureReservation: input.nextReservation != null,
  });
  if (RANK[alt] <= RANK[input.status]) return null;
  const dates = [...input.unconfirmedPast].sort((a, b) => b.getTime() - a.getTime()).slice(0, 2).map(dm).join(", ");
  const n = input.unconfirmedPast.length;
  return `${n === 1 ? "wynajem" : `${n} wynajmy`} ${dates} bez potwierdzenia odbioru — po potwierdzeniu: ${STATUS_WORD[alt]}`;
}

export const ROMAN_MONTHS = ROMAN;
