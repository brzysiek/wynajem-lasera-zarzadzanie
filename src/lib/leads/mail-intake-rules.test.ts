import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, band, decideNewPerson, displayName, extractNip, extractPhone, fold, isValidNip, mergeConfig, rejectReason, rentalRequestWords, scoreText } from "./mail-intake-rules";

const cfg = DEFAULT_CONFIG;
const base = { from: "anna.k@gmail.com", headers: {}, labelIds: ["INBOX"], own: false, excluded: false, blockedDomains: cfg.blockedDomains };

describe("scoreText", () => {
  it("Anna z wniosku: Alma, wynajem, szkolenie, termin → wysoka", () => {
    const r = scoreText("Wynajem Almy. Dzień dobry, pytam o szkolenie z Almy i dostępne terminy.", cfg);
    expect(r.score).toBeGreaterThanOrEqual(cfg.high);
    expect(r.matched.join(" ")).toMatch(/wynaj/);
    expect(band(r.score, cfg)).toBe("high");
  });
  it("pozycjonowanie / SEO → ujemna punktacja (niska)", () => {
    const r = scoreText("Oferta pozycjonowania strony i SEO dla Państwa gabinetu", cfg);
    expect(r.score).toBeLessThan(0);
    expect(band(r.score, cfg)).toBe("low");
  });
  it("znaki polskie nie przeszkadzają, krótkie słowa tylko jako całe słowo", () => {
    expect(fold("Wynająć ŁÓDŹ")).toBe("wynajac lodz");
    expect(scoreText("wynająć laser", cfg).score).toBeGreaterThan(0);
    expect(scoreText("seoul trip", cfg).score).toBe(0); // „seo” nie w środku słowa
    expect(scoreText("ceny usług", cfg).score).toBe(0); // „cena” to całe słowo
  });
  it("każde słowo liczy się raz", () => {
    expect(scoreText("termin termin termin", cfg).score).toBe(1);
  });
});

describe("decideNewPerson — tryby", () => {
  it("ostrożny: wysoka i średnia → do sprawdzenia, niska → odrzucone", () => {
    const c = { ...cfg, mode: "CAUTIOUS" as const };
    expect(decideNewPerson(9, c)).toBe("DO_SPRAWDZENIA");
    expect(decideNewPerson(3, c)).toBe("DO_SPRAWDZENIA");
    expect(decideNewPerson(1, c)).toBe("ODRZUCONY");
    expect(decideNewPerson(-4, c)).toBe("ODRZUCONY");
  });
  it("AUTO: wysoka zakłada sygnał, średnia czeka, niska odpada", () => {
    const c = { ...cfg, mode: "AUTO" as const };
    expect(decideNewPerson(9, c)).toBe("SYGNAL_AUTO");
    expect(decideNewPerson(3, c)).toBe("DO_SPRAWDZENIA");
    expect(decideNewPerson(0, c)).toBe("ODRZUCONY");
  });
});

describe("rejectReason — oczywiste śmieci (2a)", () => {
  it("zwykły mail od osoby przechodzi", () => expect(rejectReason(base)).toBeNull());
  it("no-reply, nasz adres, wykluczona domena, nadawca systemowy", () => {
    expect(rejectReason({ ...base, from: "noreply@sklep.pl" })).toMatch(/no-reply/);
    expect(rejectReason({ ...base, own: true })).toBe("nasz adres");
    expect(rejectReason({ ...base, excluded: true })).toMatch(/wykluczeń/);
    expect(rejectReason({ ...base, from: "faktury@mail.fakturownia.pl" })).toMatch(/systemowy/);
  });
  it("nagłówki newslettera / automatu i kategorie Gmaila", () => {
    expect(rejectReason({ ...base, headers: { "list-unsubscribe": "<mailto:x@y.pl>" } })).toMatch(/newsletter/);
    expect(rejectReason({ ...base, headers: { "auto-submitted": "auto-replied" } })).toMatch(/automatyczna/);
    expect(rejectReason({ ...base, labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] })).toMatch(/Promocje/);
    expect(rejectReason({ ...base, labelIds: ["INBOX", "CATEGORY_SOCIAL"] })).toMatch(/Social/);
  });
});

describe("wyciąganie danych", () => {
  it("telefon w różnych zapisach → +48…", () => {
    expect(extractPhone("Pozdrawiam, tel. 600 100 200")).toBe("+48600100200");
    expect(extractPhone("kontakt: +48 601-234-567")).toBe("+48601234567");
    expect(extractPhone("531574115")).toBe("+48531574115");
    expect(extractPhone("nr zamówienia 1234567890123")).toBeNull();
    expect(extractPhone("brak numeru")).toBeNull();
  });
  it("NIP tylko z poprawną sumą kontrolną", () => {
    expect(isValidNip("5260250995")).toBe(true); // znany poprawny NIP testowy
    expect(isValidNip("5260250996")).toBe(false);
    expect(extractNip("NIP: 526-025-09-95, adres …")).toBe("5260250995");
    expect(extractNip("NIP 5260250996")).toBeNull();
    expect(extractNip("tel 600100200")).toBeNull();
  });
  it("nazwa nadawcy z nagłówka", () => {
    expect(displayName('"Anna Klęczar" <a@b.pl>')).toBe("Anna Klęczar");
    expect(displayName("Anna <a@b.pl>")).toBe("Anna");
    expect(displayName("a@b.pl")).toBeNull();
    expect(displayName(undefined)).toBeNull();
  });
});

describe("prośba o wynajem od klientki z bazy", () => {
  it("wykrywa słowa prośby", () => {
    expect(rentalRequestWords("Czy Alma jest wolna w listopadzie? Proszę o termin", cfg)).toEqual(expect.arrayContaining(["alma", "termin"]));
    expect(rentalRequestWords("Dziękuję za wczorajszą dostawę", cfg)).toEqual([]);
  });
});

describe("mergeConfig", () => {
  it("brak / śmieci → domyślna; edytowane słowa i progi działają", () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(mergeConfig("zle")).toEqual(DEFAULT_CONFIG);
    const c = mergeConfig({ mode: "AUTO", high: 8, medium: 20, positive: [{ word: " Kriolipoliza ", points: 4 }, { word: "", points: 1 }], negative: [{ word: "Spam", points: 5 }], blockedDomains: ["Example.PL"] });
    expect(c.mode).toBe("AUTO");
    expect(c.high).toBe(8);
    expect(c.medium).toBe(8); // próg średni nie wyższy niż wysoki
    expect(c.positive).toEqual([{ word: "kriolipoliza", points: 4 }]);
    expect(c.negative).toEqual([{ word: "spam", points: -5 }]);
    expect(c.blockedDomains).toEqual(["example.pl"]);
  });
});
