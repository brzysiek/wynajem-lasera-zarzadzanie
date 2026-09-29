// Tytuł rezerwacji = nazwa robocza klienta (poprawka wniosku 29). Bez
// zależności — testowane w vitest.

const TIME_PREFIX_RE = /^(\d{2}:\d{2}) /;

export function clientTitleName(c: { name: string; shortName: string | null }): string {
  return c.shortName?.trim() || c.name.trim();
}

// Tytuł bez prefiksu godziny dostawy („10:00 NOWA PaNI” → „NOWA PaNI”).
export function bareTitle(title: string): string {
  return title.replace(TIME_PREFIX_RE, "").trim();
}

// Nowy tytuł z zachowaniem godziny dostawy: z pola deliveryTime, a gdy go
// nie ma — z prefiksu dotychczasowego tytułu (wydarzenia z Google).
export function retitle(oldTitle: string, name: string, deliveryTime: string | null | undefined): string {
  const time = deliveryTime?.trim() || oldTitle.match(TIME_PREFIX_RE)?.[1] || null;
  return time ? `${time} ${name}` : name;
}

export function titleDiffers(title: string, name: string): boolean {
  return bareTitle(title).localeCompare(name.trim(), "pl", { sensitivity: "base" }) !== 0;
}
