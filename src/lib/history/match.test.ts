import { describe, expect, it } from "vitest";
import { buildMatcher, tokensMatch, type MatchClient } from "./match";
import { normalizeTitle } from "./normalize-title";

const phone = (raw: string) => {
  const d = raw.replace(/[^\d]/g, "").replace(/^48(?=\d{9}$)/, "");
  return /^\d{9}$/.test(d) ? `+48${d}` : null;
};

const person = (firstName: string | null, lastName: string | null, extra: Partial<MatchClient["contacts"][0]> = {}) => ({
  firstName,
  lastName,
  phone: null,
  email: null,
  ...extra,
});

const clients: MatchClient[] = [
  { id: "bloom", name: "Bloom House", city: "Kraków", nip: null, contacts: [person("Wiktoria", "Pisarek")] },
  { id: "kolber", name: "Katarzyna Kolber", city: "Tarnów", nip: null, contacts: [person("Katarzyna", "Kolber")] },
  { id: "sha", name: "SHA Beauty Clinic", city: "Warszawa", nip: "1234563218", contacts: [person("Anna", "Nowak")] },
  { id: "mariola", name: "Mariola Wrona", city: "Spytkowice", nip: null, contacts: [person("Mariola", "Wrona")] },
  { id: "anna1", name: "Anna Kowalska", city: "Łódź", nip: null, contacts: [person("Anna", "Kowalska", { phone: "+48601000111" })] },
  { id: "anna2", name: "Anna Pawlik", city: "Kielce", nip: null, contacts: [person("Anna", "Pawlik", { email: "anna@pawlik.pl" })] },
  { id: "lucyna", name: "Gabinet Lucyna", city: null, nip: null, contacts: [person("Lucyna", "Bąk")] },
];

const match = buildMatcher(clients, new Map([["kuter port nieznanowice", "mariola"]]), phone);
const key = (title: string) => normalizeTitle(title).key;

describe("tokensMatch", () => {
  it("odmiana i literówki", () => {
    expect(tokensMatch("lucyny", "lucyna")).toBe(true);
    expect(tokensMatch("krakow", "krakowa")).toBe(true);
    expect(tokensMatch("anna", "anka")).toBe(false); // za krótkie na literówkę
    expect(tokensMatch("ola", "olaf")).toBe(false);
  });
});

describe("buildMatcher", () => {
  it("telefon z opisu wygrywa ze wszystkim", () => {
    const r = match(key("Bloom House"), { phones: ["+48601000111"], emails: [], nips: [] });
    expect(r).toMatchObject({ clientId: "anna1", method: "PHONE", state: "AUTO" });
  });

  it("e-mail i NIP z opisu", () => {
    expect(match("", { phones: [], emails: ["Anna@Pawlik.pl"], nips: [] })).toMatchObject({ clientId: "anna2", method: "EMAIL" });
    expect(match("", { phones: [], emails: [], nips: ["1234563218"] })).toMatchObject({ clientId: "sha", method: "NIP" });
  });

  it("alias potwierdzony przez biuro", () => {
    expect(match(key("Kuter Port Nieznanowice - mała głowica"))).toMatchObject({
      clientId: "mariola",
      method: "MANUAL",
      state: "CONFIRMED",
    });
  });

  it("firma + osoba w tytule → AUTO", () => {
    expect(match(key("Bloom House Wiktoria Pisarek"))).toMatchObject({ clientId: "bloom", state: "AUTO", method: "NAME_AUTO" });
  });

  it("pełne imię i nazwisko w dowolnej kolejności → AUTO", () => {
    expect(match(key("Pawlik Anna 2 gł."))).toMatchObject({ clientId: "anna2", state: "AUTO" });
    expect(match(key("Anna Pawlik"))).toMatchObject({ clientId: "anna2", state: "AUTO" });
  });

  it("samo nazwisko → propozycja do potwierdzenia", () => {
    const r = match(key("SZKOLENIE KOLBER"));
    expect(r.state).toBe("SUGGESTED");
    expect(r.candidates[0].clientId).toBe("kolber");
  });

  it("skrót firmy → propozycja", () => {
    const r = match(key("SHA Quattro do potwierdz."));
    expect(r.state).toBe("SUGGESTED");
    expect(r.candidates[0].clientId).toBe("sha");
  });

  it("imię + miasto klienta → propozycja z premią za miasto", () => {
    const r = match(key("P. Mariola Spytkowice - 2 gł."));
    expect(r.state).toBe("SUGGESTED");
    expect(r.candidates[0].clientId).toBe("mariola");
  });

  it("odmiana imienia", () => {
    const r = match(key("Lucyny 2 gł."));
    expect(r.candidates[0]?.clientId).toBe("lucyna");
  });

  it("samo wspólne imię nie przypisuje automatycznie", () => {
    const r = match(key("Anna"));
    expect(r.state).not.toBe("AUTO");
  });

  it("nieznana osoba z popularnym imieniem → bez dopasowania", () => {
    expect(match(key("Anna Orlova Wiślna 5")).state).toBe("UNMATCHED");
  });

  it("samo miasto to nie klient", () => {
    expect(match(key("Kraków")).state).toBe("UNMATCHED");
  });

  it("pusty klucz", () => {
    expect(match("").state).toBe("UNMATCHED");
  });

  describe("uczenie z decyzji biura", () => {
    const learned = buildMatcher(
      clients,
      new Map([
        ["kuter port nieznanowice", "mariola"],
        ["sha", "sha"],
        ["nowy sacz nurek", "kolber"],
        ["anna", "anna1"], // ogólnik — nie może przypisywać automatycznie
      ]),
      phone,
    );

    it("potwierdzony tytuł w innej kolejności słów → AUTO", () => {
      expect(learned(key("Nurek Nowy Sącz 2 gł."))).toMatchObject({ clientId: "kolber", state: "AUTO" });
    });

    it("potwierdzony tytuł zawarty w dłuższym → AUTO", () => {
      expect(learned(key("SHA 1 gł. Tym razem + okulary"))).toMatchObject({ clientId: "sha", state: "AUTO" });
      expect(learned(key("Kuter Port Nieznanowice nowa klientka"))).toMatchObject({ clientId: "mariola", state: "AUTO" });
    });

    it("ogólny alias (samo imię) nie przypisuje automatycznie", () => {
      expect(learned(key("Anna Orlova"))).not.toMatchObject({ state: "AUTO" });
    });
  });

  it("pełne imię i nazwisko w dłuższym tytule → AUTO", () => {
    expect(match(key("Anna Pawlik tym razem okulary"))).toMatchObject({ clientId: "anna2", state: "AUTO" });
  });

  it("słowa-szum z danych nie zaniżają dopasowania", () => {
    const withNoise = buildMatcher(clients, new Map(), phone, undefined, new Set(["okulary", "nowa"]));
    const r = withNoise(key("Kolber okulary nowa"));
    expect(r.candidates[0]?.clientId).toBe("kolber");
    expect(match(key("Kolber okulary nowa")).state).toBe("UNMATCHED");
  });
});
