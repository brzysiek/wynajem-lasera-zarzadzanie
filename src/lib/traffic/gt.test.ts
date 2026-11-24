import { describe, expect, it } from "vitest";
import { TCH, classifyChannel, dropTestEvents, parseBeacon, parseClickKind } from "./ingest";
import { adsMetricsByKey, campKey, chKey, reclassify } from "./ads";
import { abandonStep, buildTrafficReport, gtHasBraid, gtKindOf, type TrafficRow } from "./report";
import { clickKindOf } from "../leads/google-conversions";

const at = new Date("2026-11-24T10:00:00Z");
const G = { src: "google.com", g: true, utm: { utm_source: "google", utm_medium: "cpc", utm_campaign: "alma", utm_term: "[laser]", utm_content: "111" } };
const entry = (pv: string, dev: string, gt: string | null | undefined, extra: Record<string, unknown> = {}): TrafficRow => {
  const d = { ...G, prev: "", ...(gt === undefined ? {} : { gt }), ...extra };
  const info = classifyChannel(d);
  return { at, pv, path: "/alma/", dev, type: "wejscie", channel: info.channel, data: { ...d, channel: info.channel, campaignKey: info.campaignKey, campaign: info.campaign, term: info.term, group: info.group } };
};
const ev = (pv: string, dev: string, type: string, data: Record<string, unknown> = {}): TrafficRow => ({ at, pv, path: "/alma/", dev, type, channel: TCH.GOOGLE_ADS, data });

describe("gt — walidacja w /api/ruch", () => {
  const beacon = (o: Record<string, unknown>) => parseBeacon(JSON.stringify({ pv: "abc123def", path: "/alma/", dev: "telefon", ev: [{ e: "wejscie", g: 1, utm: {}, ...o }] }));
  it("przepuszcza whitelistę i połączenia z „+”, resztę zamienia na null", () => {
    expect(parseClickKind("gclid")).toBe("gclid");
    expect(parseClickKind("gbraid")).toBe("gbraid");
    expect(parseClickKind("wbraid")).toBe("wbraid");
    expect(parseClickKind("gclid+gbraid")).toBe("gclid+gbraid");
    expect(parseClickKind("wbraid+gclid")).toBe("gclid+wbraid"); // stała kolejność
    expect(parseClickKind("gclid+gclid")).toBe("gclid");
    for (const bad of ["", "fbclid", "gclid+fbclid", "gclid+", "ABC123def456", "x".repeat(31), "gclid+gbraid+wbraid+gclid+gbraid+wbraid+x", 5, null, undefined, { a: 1 }]) expect(parseClickKind(bad)).toBeNull();
  });
  it("wejscie zapisuje gt (albo null) i nie odrzuca zdarzenia", () => {
    const r = beacon({ gt: "gclid+gbraid" });
    expect(r.ok && r.beacon.events[0].data).toMatchObject({ g: true, gt: "gclid+gbraid" });
    const bad = beacon({ gt: "CjwKCAjw-prawdziwy-gclid" });
    expect(bad.ok && bad.beacon.events[0].data).toMatchObject({ g: true, gt: null });
    const old = beacon({});
    expect(old.ok && old.beacon.events[0].data.gt).toBeNull();
  });
  it("nazwy przycisków z polskimi znakami nie są obcinane ani odrzucane (limit 40)", () => {
    const r = parseBeacon(JSON.stringify({ pv: "abc123def", path: "/alma/", dev: "telefon", ev: [
      { e: "form_porzucony", form: "5878", pole: "[lsr-tile] Alma Harmony XL Pro", bledy: 0 },
      { e: "form_porzucony", form: "5878", pole: "[lsr-next] Dalej ➔" },
      { e: "form_blad", form: "5878", pola: ["[button] 2", "[lsr-tile] Żółć — gęślą", "telefon"] },
      { e: "form_porzucony", form: "5878", pole: `[lsr-tile] ${"ż".repeat(60)}` },
      { e: "form_porzucony", form: "5878", pole: `${"a".repeat(39)}😀` },
    ] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.beacon.events;
    expect(ev[0].data.pole).toBe("[lsr-tile] Alma Harmony XL Pro");
    expect(ev[1].data.pole).toBe("[lsr-next] Dalej ➔");
    expect(ev[2].data.pola).toEqual(["[button] 2", "[lsr-tile] Żółć — gęślą", "telefon"]);
    expect((ev[3].data.pole as string).length).toBe(40);
    expect(ev[4].data.pole).toBe("a".repeat(39)); // połówka emoji nie zostaje
  });
});

describe("gt — raport ruchu", () => {
  it("klasyfikacja rodzajów", () => {
    expect(["gclid", "gbraid", "wbraid", "gclid+gbraid", null, undefined, ""].map(gtKindOf)).toEqual(["gclid", "gbraid", "wbraid", "inne", "brak", "brak", "brak"]);
    expect([gtHasBraid("gbraid"), gtHasBraid("gclid+wbraid"), gtHasBraid("gclid"), gtHasBraid(null)]).toEqual([true, true, false, false]);
  });
  const rows = reclassify([
    entry("a", "telefon", "gclid"),
    entry("b", "telefon", "gbraid"),
    entry("c", "komputer", "wbraid"),
    entry("d", "tablet", "gclid+gbraid"),
    entry("e", "telefon", undefined), // sprzed 24.11
    entry("f", "telefon", null),
    ev("b", "telefon", "form_start", { form: "5894" }),
    ev("a", "telefon", "form_start", { form: "5894" }),
  ]);
  const r = buildTrafficReport(rows, { from: "2026-11-24", to: "2026-11-24" });
  it("Google Ads wg rodzaju kliknięcia z urządzeniem i startem formularza", () => {
    const t = r.gt.total;
    expect(t.gclid).toMatchObject({ visits: 1, formStarts: 1 });
    expect(t.gbraid).toMatchObject({ visits: 1, formStarts: 1, byDev: { telefon: 1 } });
    expect(t.wbraid).toMatchObject({ visits: 1, formStarts: 0, byDev: { komputer: 1 } });
    expect(t.inne).toMatchObject({ visits: 1, byDev: { tablet: 1 } });
    expect(t.brak).toMatchObject({ visits: 2, formStarts: 0 });
    expect(r.gt.campaigns).toHaveLength(1);
    expect(r.gt.campaigns[0]).toMatchObject({ key: "alma" });
    expect(r.gt.campaigns[0].gt.gbraid.visits).toBe(1);
  });
  it("metryki reklam: udział gbraid+wbraid tylko z wejść z ustalonym rodzajem", () => {
    const m = adsMetricsByKey(rows);
    const camp = m.get(campKey(TCH.GOOGLE_ADS, "alma"))!;
    expect(camp).toMatchObject({ wejscia: 6, z_rodzajem_klikniecia: 4, wejscia_gbraid_wbraid: 3, gbraid_wbraid_proc: 75 });
    expect(m.get(chKey(TCH.GOOGLE_ADS))!.wejscia_gbraid_wbraid).toBe(3);
  });
  it("brak wejść z gt = null, nie 0%", () => {
    const m = adsMetricsByKey(reclassify([entry("x", "telefon", undefined)]));
    expect(m.get(campKey(TCH.GOOGLE_ADS, "alma"))).toMatchObject({ z_rodzajem_klikniecia: 0, gbraid_wbraid_proc: null });
  });
});

describe("porzucenia wielokrokowych formularzy", () => {
  it("krok 1 (przyciski) vs krok 2 (pola)", () => {
    expect(["[lsr-tile] Alma Harmony XL Pro", "[button] 2", "[lsr-next] Dalej ➔", "[LSR-NEXT] Dalej", "telefon", "email", "[inny] x", "(nieznane pole)", ""].map(abandonStep)).toEqual([
      "krok1_przycisk", "krok1_przycisk", "krok1_przycisk", "krok1_przycisk", "krok2_pola", "krok2_pola", "inne_przyciski", "nieznane", "nieznane",
    ]);
  });
  it("raport: podział tylko dla formularzy wielokrokowych", () => {
    const rows: TrafficRow[] = [
      entry("p1", "telefon", "gclid"),
      ev("p1", "telefon", "form_porzucony", { form: "5878", pole: "[lsr-tile] Alma Harmony XL Pro" }),
      entry("p2", "telefon", "gclid"),
      ev("p2", "telefon", "form_porzucony", { form: "5878", pole: "telefon" }),
      entry("p3", "telefon", "gclid"),
      ev("p3", "telefon", "form_porzucony", { form: "5878", pole: "[lsr-next] Dalej ➔" }),
      ev("p3", "telefon", "form_porzucony", { form: "5894", pole: "email" }),
    ];
    const r = buildTrafficReport(rows, { from: "2026-11-24", to: "2026-11-24" });
    expect(r.forms.find((f) => f.form === "5878")!.abandonSteps).toEqual({ krok1_przycisk: 2, krok2_pola: 1, inne_przyciski: 0, nieznane: 0 });
    expect(r.forms.find((f) => f.form === "5894")!.abandonSteps).toBeNull();
    expect(r.forms.find((f) => f.form === "5878")!.abandoned.map((a) => a.field)).toContain("[lsr-tile] Alma Harmony XL Pro");
  });
});

describe("zdarzenia testowe", () => {
  it("odsłony z utm_campaign=test-licznik-v3 są pomijane w całości", () => {
    const test = entry("t1", "telefon", "gclid", { utm: { utm_campaign: "test-licznik-v3" } });
    const rows = [test, ev("t1", "telefon", "form_start", { form: "5894" }), entry("ok", "telefon", "gclid"), ev("ok", "telefon", "koniec", {})];
    const out = dropTestEvents(rows);
    expect(out.map((r) => r.pv)).toEqual(["ok", "ok"]);
    expect(buildTrafficReport(out, { from: "2026-11-24", to: "2026-11-24" }).tiles.visits).toBe(1);
  });
});

describe("rodzaj identyfikatora w atrybucji zgłoszenia", () => {
  it("gclid ma pierwszeństwo, potem gbraid / wbraid; także z adresu wejścia", () => {
    expect(clickKindOf({ gclid: "abc" })).toBe("gclid");
    expect(clickKindOf({ last_gclid: "abc", gbraid: "x" })).toBe("gclid");
    expect(clickKindOf({ gbraid: "x" })).toBe("gbraid");
    expect(clickKindOf({ last_wbraid: "x" })).toBe("wbraid");
    expect(clickKindOf({ landing_url: "https://wynajemlasera.pl/alma/?utm_source=google&gbraid=0AAAA" })).toBe("gbraid");
    expect(clickKindOf({ utm_source: "google" })).toBeNull();
    expect(clickKindOf(null)).toBeNull();
  });
});
