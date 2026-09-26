// Czas pracy biura dla Sygnałów (prompt 2, 3.2): pon–pt 8–18, czas lokalny.
// Serwer i przeglądarki biura działają w Europe/Warsaw (jak reszta panelu,
// src/lib/clients/status.ts), więc liczymy po lokalnych składowych daty.
// Czyste funkcje bez zależności (vitest bez aliasu "@/").

export const WORK_START_HOUR = 8;
export const WORK_END_HOUR = 18;
// Sygnał czekający dłużej na pierwszy kontakt jest „pilny” (czerwony).
export const URGENT_AFTER_WORK_HOURS = 24;

const isWorkday = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Godziny robocze między dwiema chwilami (0, gdy `to` ≤ `from`).
export function workHoursBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let total = 0;
  for (let day = startOfDay(from); day < to; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    if (!isWorkday(day)) continue;
    const open = new Date(day.getFullYear(), day.getMonth(), day.getDate(), WORK_START_HOUR);
    const close = new Date(day.getFullYear(), day.getMonth(), day.getDate(), WORK_END_HOUR);
    const a = Math.max(open.getTime(), from.getTime());
    const b = Math.min(close.getTime(), to.getTime());
    if (b > a) total += (b - a) / 3_600_000;
  }
  return total;
}

// Kolejny dzień roboczy (początek dnia) po dniu `from`.
export function nextWorkday(from: Date): Date {
  let d = startOfDay(from);
  do d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  while (!isWorkday(d));
  return d;
}

export function addWorkdays(from: Date, n: number): Date {
  let d = startOfDay(from);
  for (let i = 0; i < n; i++) d = nextWorkday(d);
  return d;
}

// „czeka 3 h” / „czeka < 1 h” — w godzinach roboczych.
export function waitingLabel(hours: number): string {
  if (hours < 1) return "czeka < 1 h";
  return `czeka ${Math.floor(hours)} h`;
}
