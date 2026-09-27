// Region klienta do szybkiego filtra listy (lista klientów, pkt 1; decyzja
// Tomka 27.09.2026): powiat krakowski / Małopolska / Podkarpacie / Śląsk /
// Świętokrzyskie / inne. Liczony z kodu pocztowego, bez kodu — z miasta,
// inaczej „Inne”. Czysty moduł (vitest bez aliasu "@/").
//
// „Powiat krakowski” = strefa dostaw wokół Krakowa: Kraków (30-, 31-) i
// kody 32-0xx (Skawina, Liszki, Rudawa, Zabierzów, Zielonki, Wieliczka,
// Niepołomice…) — granice poczty, nie administracyjne.

export const REGIONS = ["KRAKOWSKI", "MALOPOLSKA", "PODKARPACIE", "SLASK", "SWIETOKRZYSKIE", "INNE"] as const;
export type RegionKey = (typeof REGIONS)[number];

export const REGION_LABEL: Record<RegionKey, string> = {
  KRAKOWSKI: "Powiat krakowski",
  MALOPOLSKA: "Małopolska",
  PODKARPACIE: "Podkarpacie",
  SLASK: "Śląsk",
  SWIETOKRZYSKIE: "Świętokrzyskie",
  INNE: "Inne",
};

// Kod pocztowy → region; null = kod nieczytelny (wtedy decyduje miasto).
export function regionFromZip(zip: string | null | undefined): RegionKey | null {
  const d = (zip ?? "").replace(/\D/g, "");
  if (d.length !== 5) return null;
  const p2 = Number(d.slice(0, 2));
  const p3 = Number(d.slice(0, 3));
  if (p2 === 30 || p2 === 31 || p3 === 320) return "KRAKOWSKI";
  if (p2 === 32) return "MALOPOLSKA";
  if (p2 === 33) return "MALOPOLSKA";
  if (p2 === 34) return p3 === 343 ? "SLASK" : "MALOPOLSKA"; // 34-3xx Żywiec
  if (p2 === 38) return p3 === 383 ? "MALOPOLSKA" : "PODKARPACIE"; // 38-3xx Gorlice
  if (p2 >= 35 && p2 <= 39) return "PODKARPACIE";
  if (p2 >= 40 && p2 <= 44) return "SLASK";
  if (p3 === 474) return "SLASK"; // Racibórz
  if (p2 === 25 || p2 === 28) return "SWIETOKRZYSKIE";
  if (p2 === 26) return p3 <= 262 ? "SWIETOKRZYSKIE" : "INNE"; // 26-3xx+ łódzkie / mazowieckie
  if (p2 === 27) return p3 >= 272 ? "SWIETOKRZYSKIE" : "INNE"; // 27-1xx Iłża — mazowieckie
  if (p3 === 291) return "SWIETOKRZYSKIE"; // Włoszczowa
  return "INNE";
}

const n = (s: string) =>
  s
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim();

// Miejscowości, które najczęściej trafiają się bez kodu pocztowego.
const CITY_REGION: [string, RegionKey][] = [
  ...["krakow", "wieliczka", "skawina", "niepolomice", "zabierzow", "liszki", "rudawa", "zielonki", "michalowice", "mogilany", "radziszow", "krzeszowice", "swiatniki gorne", "czernichow", "kocmyrzow", "biskupice", "wegrzce"].map(
    (c): [string, RegionKey] => [c, "KRAKOWSKI"],
  ),
  ...[
    "tarnow", "nowy sacz", "nowy targ", "zakopane", "myslenice", "wadowice", "andrychow", "oswiecim", "chrzanow", "olkusz", "bochnia", "brzesko", "gorlice",
    "limanowa", "mszana dolna", "sucha beskidzka", "rabka", "jablonka", "kety", "trzebinia", "dabrowa tarnowska", "stary sacz", "krynica", "miechow", "proszowice",
  ].map((c): [string, RegionKey] => [c, "MALOPOLSKA"]),
  ...["rzeszow", "krosno", "przemysl", "mielec", "debica", "jaslo", "sanok", "tarnobrzeg", "stalowa wola", "lesko", "brzozow", "lancut", "jaroslaw", "ropczyce", "strzyzow", "ustrzyki"].map(
    (c): [string, RegionKey] => [c, "PODKARPACIE"],
  ),
  ...[
    "katowice", "gliwice", "bielsko biala", "czestochowa", "sosnowiec", "tychy", "rybnik", "zabrze", "bytom", "chorzow", "dabrowa gornicza", "jaworzno", "zywiec", "cieszyn",
    "myslowice", "ruda slaska", "jastrzebie zdroj", "pszczola", "pszczyna", "zawiercie", "wodzislaw", "raciborz", "mikolow", "siemianowice", "piekary", "bedzin", "ustron", "wisla",
  ].map((c): [string, RegionKey] => [c, "SLASK"]),
  ...["kielce", "busko zdroj", "sandomierz", "ostrowiec swietokrzyski", "starachowice", "skarzysko kamienna", "jedrzejow", "staszow", "pinczow", "konskie", "wloszczowa", "kazimierza wielka"].map(
    (c): [string, RegionKey] => [c, "SWIETOKRZYSKIE"],
  ),
];

// Miasto → region: pierwsza znana miejscowość w wolnym tekście
// („Wieliczka / Kraków: Żabiniec” → powiat krakowski).
export function regionFromCity(city: string | null | undefined): RegionKey | null {
  const t = ` ${n(city ?? "")} `;
  if (t.trim() === "") return null;
  let best: { at: number; region: RegionKey } | null = null;
  for (const [name, region] of CITY_REGION) {
    const at = t.indexOf(` ${name} `);
    if (at >= 0 && (!best || at < best.at)) best = { at, region };
  }
  return best?.region ?? null;
}

export function computeRegion(zip: string | null | undefined, city: string | null | undefined): RegionKey {
  return regionFromZip(zip) ?? regionFromCity(city) ?? "INNE";
}
