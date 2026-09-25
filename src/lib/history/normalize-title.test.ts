import { describe, expect, it } from "vitest";
import { extractSignals, normalizeTitle } from "./normalize-title";

const phone = (raw: string) => {
  const d = raw.replace(/[^\d+]/g, "");
  if (/^\d{9}$/.test(d)) return `+48${d}`;
  if (/^48\d{9}$/.test(d)) return `+${d}`;
  if (/^\+48\d{9}$/.test(d)) return d;
  return null;
};

// Prawdziwe tytuły z kalendarzy urządzeń (próbka 25.09.2026).
describe("normalizeTitle — prawdziwe tytuły", () => {
  const cases: [string, string, string][] = [
    ["SZKOLENIE KOLBER", "kolber", "SZKOLENIE"],
    ["Anna Pawlik", "anna pawlik", "WYNAJEM"],
    ["P. Mariola Spytkowice - 2 gł. ", "mariola spytkowice", "WYNAJEM"],
    ["Cooltech serwis 9.00", "serwis", "INNE"],
    ["Dominika Kościelniak - QUATTRO", "dominika koscielniak", "WYNAJEM"],
    ["Maria Orlova, Wiślna 5 Kraków ", "maria orlova wislna krakow", "WYNAJEM"],
    ["DermaZone 2 gł. ", "dermazone", "WYNAJEM"],
    ["SHA 1 gł. Tym razem + okulary", "sha tym razem okulary", "WYNAJEM"],
    ["Klaudia Sobota Bundz  Krakówdwie głowice", "klaudia sobota bundz krakow", "WYNAJEM"],
    ["Sprzęt u Lucyny", "sprzet u lucyny", "INNE"],
    ["Kinga Myśliwiec 1 gł.", "kinga mysliwiec", "WYNAJEM"],
    ["Yocoshi 1 gł. Bronowice", "yocoshi bronowice", "WYNAJEM"],
    ["SHA Quattro do potwierdz.", "sha", "WYNAJEM"],
    ["P. Kolber Krio", "kolber", "WYNAJEM"],
    ["Rudawa P. Basia - Desire 2 głowice", "rudawa basia", "WYNAJEM"],
    ["p. Targosz Małgosia", "targosz malgosia", "WYNAJEM"],
    ["Martina Kielesz Bottega", "martina kielesz bottega", "WYNAJEM"],
    ["Skalbmierz Beauty in 2 gł", "skalbmierz beauty in", "WYNAJEM"],
    ["So Skin Studio Katowice Alma", "so skin studio katowice", "WYNAJEM"],
    ["08:00 Gold Touch Olkusz", "gold touch olkusz", "WYNAJEM"],
    ["Kuter Port Nieznanowice - mała głowica", "kuter port nieznanowice", "WYNAJEM"],
    ["Natalia Lesko Alma Szkolenie", "natalia lesko", "SZKOLENIE"],
    ["FV", "", "INNE"],
    ["⚠ Lubartów- rezerwacja", "lubartow", "WYNAJEM"],
  ];
  for (const [title, key, kind] of cases) {
    it(title, () => {
      const n = normalizeTitle(title);
      expect(n.kind).toBe(kind);
      if (kind !== "INNE") expect(n.key).toBe(key);
    });
  }

  it("te same klientki w różnych zapisach dają ten sam klucz", () => {
    expect(normalizeTitle("Bottega Beauty 2 gl.").key).toBe(normalizeTitle("Bottega Beauty 2gł").key);
    expect(normalizeTitle("SHA 2 gł.").key).toBe(normalizeTitle("SHA Quattro").key);
  });

  it("nie zjada słów zaczynających się od „gl”", () => {
    expect(normalizeTitle("Glamour Studio").key).toBe("glamour studio");
  });
});

describe("extractSignals", () => {
  it("telefon, e-mail i NIP z opisu", () => {
    const s = extractSignals("Godz. 8.00, Ewelina Stachura 888149789 mail: Ewa@Gabinet.pl NIP 944-228-55-99", phone);
    expect(s.phones).toEqual(["+48888149789"]);
    expect(s.emails).toEqual(["ewa@gabinet.pl"]);
    expect(s.nips).toEqual(["9442285599"]);
  });

  it("zwykłe liczby w opisie nie są telefonem ani NIP-em", () => {
    const s = extractSignals("6 membran (1 w zapasie), od 9.00 do 21.00", phone);
    expect(s).toEqual({ phones: [], emails: [], nips: [] });
  });
});
