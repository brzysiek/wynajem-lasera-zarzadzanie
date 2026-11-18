import { describe, expect, it } from "vitest";
import {
  backfillFromLandingUrl,
  buildCsv,
  clickIdStats,
  clickIdsFromUrl,
  conversionsFor,
  consentState,
  csvTime,
  eligibility,
  pickClickId,
  stageOfActivity,
  stageTimes,
  type Attr,
  type LeadForConversions,
} from "./google-conversions";

const d = (s: string) => new Date(s);
const NOW = d("2026-11-18T12:00:00Z");

function lead(over: Partial<LeadForConversions> = {}): LeadForConversions {
  return {
    id: "L1",
    createdAt: d("2026-11-01T08:00:00Z"),
    stage: "SYGNAL",
    stageChangedAt: d("2026-11-01T08:00:00Z"),
    archivedAt: null,
    contactEmail: "ola@gabinet.pl",
    firstContactAt: null,
    attribution: { gclid: "G1", wl_consent_marketing: "1" },
    rentalId: null,
    rentalCreatedAt: null,
    rentalNet: null,
    activities: [],
    ...over,
  };
}

describe("identyfikator kliknięcia", () => {
  it("ostatnie wejście przed pierwszym; gclid → gbraid → wbraid", () => {
    expect(pickClickId({ gclid: "A", last_gclid: "B" })).toEqual({ kind: "gclid", value: "B" });
    expect(pickClickId({ gclid: "A", last_gbraid: "GB" })).toEqual({ kind: "gbraid", value: "GB" });
    expect(pickClickId({ gbraid: "GB", wbraid: "WB" })).toEqual({ kind: "gbraid", value: "GB" });
    expect(pickClickId({ wbraid: "WB" })).toEqual({ kind: "wbraid", value: "WB" });
    expect(pickClickId({ utm_source: "google" })).toBeNull();
    expect(pickClickId(null)).toBeNull();
  });
  it("czyta gclid / gbraid / wbraid z adresu", () => {
    expect(clickIdsFromUrl("https://wynajemlasera.pl/alma/?utm_term=x&gbraid=0AAA&utm_source=google")).toEqual({ gbraid: "0AAA" });
    expect(clickIdsFromUrl("/x?gclid=Q&wbraid=W#frag")).toEqual({ gclid: "Q", wbraid: "W" });
    expect(clickIdsFromUrl("https://wynajemlasera.pl/")).toEqual({});
    expect(clickIdsFromUrl(null)).toEqual({});
  });
  it("uzupełnienie ze starego adresu: dopisuje gbraid/wbraid, nie nadpisuje, nic nie robi bez potrzeby", () => {
    const attr: Attr = { landing_url: "https://wynajemlasera.pl/alma/?gbraid=0AAA", utm_source: "google" };
    expect(backfillFromLandingUrl(attr)).toEqual({ ...attr, gbraid: "0AAA" });
    expect(backfillFromLandingUrl({ ...attr, gbraid: "JUZ" })).toBeNull();
    expect(backfillFromLandingUrl({ landing_url: "https://wynajemlasera.pl/?gclid=X" })).toBeNull();
    expect(backfillFromLandingUrl(null)).toBeNull();
  });
});

describe("statystyka identyfikatorów", () => {
  it("z gclid / bez gclid z gbraid (zapisanym albo w adresie) / bez żadnego; ile do uzupełnienia", () => {
    const st = clickIdStats([
      { attribution: { gclid: "A", landing_url: "https://x.pl/?gclid=A" } },
      { attribution: { last_gclid: "B" } },
      { attribution: { landing_url: "https://x.pl/?gbraid=0AA" } }, // tylko w adresie → do uzupełnienia
      { attribution: { gbraid: "0BB", landing_url: "https://x.pl/?gbraid=0BB" } }, // zapisany
      { attribution: { utm_source: "google", landing_url: "https://x.pl/" } },
      { attribution: null },
    ]);
    expect(st).toEqual({ total: 6, withGclid: 2, noGclidWithBraid: 2, none: 2, braidOnlyInUrl: 1 });
  });
});

describe("zgody", () => {
  it("tak / nie / brak danych", () => {
    expect(consentState({ wl_consent_marketing: "1" }, "wl_consent_marketing")).toBe("tak");
    expect(consentState({ wl_consent_marketing: "0" }, "wl_consent_marketing")).toBe("nie");
    expect(consentState({}, "wl_consent_statistics")).toBe("brak danych");
    expect(consentState(null, "wl_consent_marketing")).toBe("brak danych");
  });
});

describe("kwalifikacja sygnału", () => {
  it("tylko ze zgodą marketingową = tak", () => {
    expect(eligibility(lead(), NOW)).toMatchObject({ click: { kind: "gclid" } });
    expect(eligibility(lead({ attribution: { gclid: "G1", wl_consent_marketing: "0" } }), NOW)).toEqual({ skip: "brak_zgody" });
    expect(eligibility(lead({ attribution: { gclid: "G1" } }), NOW)).toEqual({ skip: "brak_zgody" });
  });
  it("pomija zarchiwizowane, testowe, bez identyfikatora i starsze niż 90 dni", () => {
    expect(eligibility(lead({ archivedAt: d("2026-11-10T00:00:00Z") }), NOW)).toEqual({ skip: "archiwum" });
    expect(eligibility(lead({ contactEmail: "test+www-123@wynajemlasera.pl" }), NOW)).toEqual({ skip: "test" });
    expect(eligibility(lead({ attribution: { utm_source: "google", wl_consent_marketing: "1" } }), NOW)).toEqual({ skip: "brak_identyfikatora" });
    expect(eligibility(lead({ createdAt: d("2026-08-01T00:00:00Z") }), NOW)).toEqual({ skip: "stary_identyfikator" });
  });
});

describe("czas wejścia w etap", () => {
  it("parsuje wpisy historii", () => {
    expect(stageOfActivity("Nowe → W kontakcie")).toBe("WYWIAD");
    expect(stageOfActivity("Sygnał → Wywiad")).toBe("WYWIAD");
    expect(stageOfActivity("W kontakcie → Oferta wysłana")).toBe("OFERTA");
    expect(stageOfActivity("auto · mail z ofertą: „x” → Oferta wysłana · y")).toBe("OFERTA");
    expect(stageOfActivity("Rezerwacja w kalendarzu: Alma 29.11")).toBe("REZERWACJA");
    expect(stageOfActivity("Wygrana powiązana z wynajmem: Alma")).toBe("WYGRANA");
    expect(stageOfActivity("jakiś tekst")).toBeNull();
  });
  it("pierwszy wpis o etapie; pominięty etap dostaje czas następnego", () => {
    const t = stageTimes(
      lead({
        stage: "OFERTA",
        activities: [
          { type: "STAGE_CHANGE", body: "Nowe → Oferta wysłana", createdAt: d("2026-11-05T10:00:00Z") },
          { type: "STAGE_CHANGE", body: "Oferta wysłana → W kontakcie", createdAt: d("2026-11-06T10:00:00Z") },
        ],
      }),
    );
    expect(t.OFERTA).toEqual(d("2026-11-05T10:00:00Z"));
    expect(t.WYWIAD).toEqual(d("2026-11-06T10:00:00Z"));
  });
});

describe("konwersje sygnału", () => {
  const click = { kind: "gclid" as const, value: "G1" };
  it("nowy sygnał bez kontaktu — nic", () => {
    expect(conversionsFor(lead(), click)).toEqual([]);
  });
  it("rozmowa → oferta → rezerwacja → wynajem, każdy etap raz, z kwotami", () => {
    const l = lead({
      stage: "WYGRANA",
      stageChangedAt: d("2026-11-17T10:00:00Z"),
      firstContactAt: d("2026-11-02T09:00:00Z"),
      rentalId: "R1",
      rentalCreatedAt: d("2026-11-08T10:00:00Z"),
      rentalNet: 1250.5,
      activities: [
        { type: "CALL", body: "rozmowa", createdAt: d("2026-11-02T09:00:00Z") },
        { type: "STAGE_CHANGE", body: "Nowe → W kontakcie", createdAt: d("2026-11-02T09:01:00Z") },
        { type: "STAGE_CHANGE", body: "W kontakcie → Oferta wysłana", createdAt: d("2026-11-04T10:00:00Z") },
        { type: "STAGE_CHANGE", body: "Rezerwacja w kalendarzu: Alma 29.11", createdAt: d("2026-11-08T10:00:00Z") },
        { type: "STAGE_CHANGE", body: "Rezerwacja → Wygrana · wynajem zrealizowany (Alma 29.11)", createdAt: d("2026-11-17T10:00:00Z") },
      ],
    });
    const c = conversionsFor(l, click);
    expect(c.map((x) => [x.def.name, x.value, x.orderId])).toEqual([
      ["Panel – rozmowa kwalifikowana", 100, "L1-rozmowa"],
      ["Panel – oferta wysłana", 150, "L1-oferta"],
      ["Panel – rezerwacja", 1250.5, "L1-rezerwacja"],
      ["Panel – wynajem zrealizowany", 1250.5, "L1-wynajem"],
    ]);
    expect(c[1].at).toEqual(d("2026-11-04T10:00:00Z"));
  });
  it("etap W kontakcie bez odbytej rozmowy nie daje konwersji rozmowy", () => {
    const l = lead({
      stage: "WYWIAD",
      stageChangedAt: d("2026-11-03T10:00:00Z"),
      activities: [{ type: "STAGE_CHANGE", body: "Nowe → W kontakcie", createdAt: d("2026-11-03T10:00:00Z") }],
    });
    expect(conversionsFor(l, click)).toEqual([]);
  });
  it("rezerwacja bez kwoty — wiersz bez wartości", () => {
    const l = lead({ stage: "REZERWACJA", stageChangedAt: d("2026-11-09T10:00:00Z"), firstContactAt: d("2026-11-02T09:00:00Z"), rentalId: "R1", rentalCreatedAt: d("2026-11-09T10:00:00Z") });
    const rez = conversionsFor(l, click).find((x) => x.def.key === "rezerwacja");
    expect(rez?.value).toBeNull();
    expect(rez?.at).toEqual(d("2026-11-09T10:00:00Z"));
  });
  it("konwersja nie poprzedza utworzenia sygnału", () => {
    const l = lead({ stage: "OFERTA", stageChangedAt: d("2026-10-01T00:00:00Z"), activities: [{ type: "STAGE_CHANGE", body: "Nowe → Oferta wysłana", createdAt: d("2026-10-01T00:00:00Z") }] });
    expect(conversionsFor(l, click).find((x) => x.def.key === "oferta")?.at).toEqual(l.createdAt);
  });
});

describe("plik CSV", () => {
  it("strefa, nagłówek, jeden identyfikator w wierszu, bez danych osobowych", () => {
    const csv = buildCsv([
      { leadId: "L1", def: { key: "oferta", stage: "OFERTA", name: "Panel – oferta wysłana", fixedValue: 150 }, orderId: "L1-oferta", at: d("2026-11-04T09:00:00Z"), value: 150, click: { kind: "gclid", value: "G1" } },
      { leadId: "L2", def: { key: "rezerwacja", stage: "REZERWACJA", name: "Panel – rezerwacja", fixedValue: null }, orderId: "L2-rezerwacja", at: d("2026-07-04T09:30:15Z"), value: null, click: { kind: "gbraid", value: "0AAA" } },
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Parameters:TimeZone=Europe/Warsaw");
    expect(lines[1]).toBe("Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID,Ad User Data");
    expect(lines[2]).toBe("G1,,,Panel – oferta wysłana,2026-11-04 10:00:00,150.00,PLN,L1-oferta,GRANTED");
    expect(lines[3]).toBe(",0AAA,,Panel – rezerwacja,2026-07-04 11:30:15,,PLN,L2-rezerwacja,GRANTED");
    expect(csv).not.toMatch(/@|\+48/);
  });
  it("czas w Europe/Warsaw: lato +2 h, zima +1 h", () => {
    expect(csvTime(d("2026-07-01T10:00:00Z"))).toBe("2026-07-01 12:00:00");
    expect(csvTime(d("2026-12-01T10:00:00Z"))).toBe("2026-12-01 11:00:00");
  });
});
