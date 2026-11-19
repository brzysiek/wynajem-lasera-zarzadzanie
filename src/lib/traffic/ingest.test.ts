import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, MAX_EVENTS, TCH, classifyChannel, createRateLimiter, isBotUserAgent, originAllowed, parseBeacon } from "./ingest";

const batch = (over: Record<string, unknown> = {}) => JSON.stringify({ pv: "abc123def", path: "/alma/", dev: "telefon", ev: [{ e: "wejscie", t: 0, src: "google.com", utm: {}, g: 0, m: 0, zgoda: "s1m1" }, { e: "koniec", t: 31, przew: 50, czas: "10-30s", wyjscie: true }], ...over });

describe("parsowanie paczki z licznika", () => {
  it("przyjmuje wejscie + koniec, przycina i normalizuje", () => {
    const r = parseBeacon(batch());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.beacon).toMatchObject({ pv: "abc123def", path: "/alma/", dev: "telefon" });
    expect(r.beacon.events.map((e) => e.type)).toEqual(["wejscie", "koniec"]);
    expect(r.beacon.events[1].data).toMatchObject({ przew: 50, czas: "10-30s", wyjscie: true });
  });
  it("odrzuca nieznane zdarzenia, zostawia znane", () => {
    const r = parseBeacon(batch({ ev: [{ e: "haker" }, { e: "klik", rodzaj: "telefon", etyk: "Zadzwoń", x: 40.5, y: 220 }, { e: "wejscie_x" }] }));
    expect(r.ok && r.beacon.events.map((e) => e.type)).toEqual(["klik"]);
  });
  it("przycina teksty: path 200, etykieta 40, src 80, utm 120", () => {
    const long = "x".repeat(500);
    const r = parseBeacon(batch({ path: `/${long}`, ev: [{ e: "wejscie", src: long, utm: { utm_campaign: long }, zgoda: "zle" }, { e: "klik", rodzaj: "dziwny", etyk: long, x: 999, y: -5 }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.beacon.path.length).toBe(200);
    const w = r.beacon.events[0].data as { src: string; utm: Record<string, string>; zgoda: string };
    expect(w.src.length).toBe(80);
    expect(w.utm.utm_campaign.length).toBe(120);
    expect(w.zgoda).toBe("brak"); // nieznana zgoda → brak
    expect(r.beacon.events[1].data).toMatchObject({ rodzaj: "inne", x: 100, y: 0 });
    expect((r.beacon.events[1].data.etyk as string).length).toBe(40);
  });
  it("najwyżej 50 zdarzeń w paczce i 16 KB ciała", () => {
    const many = Array.from({ length: 80 }, () => ({ e: "baner_pokazany" }));
    const r = parseBeacon(batch({ ev: many }));
    expect(r.ok && r.beacon.events.length).toBe(MAX_EVENTS);
    expect(parseBeacon(batch({ ev: [{ e: "klik", etyk: "a".repeat(MAX_BODY_BYTES) }] }))).toEqual({ ok: false, reason: "too_large" });
  });
  it("odrzuca zły JSON, brak pv / path, puste paczki; nieznane urządzenie = nieznane", () => {
    expect(parseBeacon("to nie json")).toEqual({ ok: false, reason: "bad_json" });
    expect(parseBeacon(batch({ pv: "x" })).ok).toBe(false);
    expect(parseBeacon(batch({ path: "bez-ukosnika" })).ok).toBe(false);
    expect(parseBeacon(batch({ ev: [] }))).toEqual({ ok: false, reason: "empty" });
    const r = parseBeacon(batch({ dev: "lodówka" }));
    expect(r.ok && r.beacon.dev).toBe("nieznane");
  });
  it("formularze i baner: pola, porzucenie, wybór", () => {
    const r = parseBeacon(batch({ ev: [{ e: "form_blad", form: "5894", pola: ["telefon", "email"] }, { e: "form_porzucony", form: "5894", pole: "telefon", bledy: 2 }, { e: "baner_wybor", wybor: "odrzucam", zgoda: "s0m0" }, { e: "baner_wybor", wybor: "xx" }] }));
    expect(r.ok && r.beacon.events.length).toBe(3); // wybór spoza listy odrzucony
    expect(r.ok && r.beacon.events[0].data).toMatchObject({ form: "5894", pola: ["telefon", "email"] });
  });
  it("nie zapisuje niczego, czego nie ma w schemacie (np. user-agent, IP w ciele)", () => {
    const r = parseBeacon(batch({ ua: "Mozilla", ip: "1.2.3.4", ev: [{ e: "klik", rodzaj: "menu", etyk: "x", ua: "Mozilla", ip: "1.2.3.4" }] }));
    expect(JSON.stringify(r)).not.toMatch(/Mozilla|1\.2\.3\.4/);
  });
});

describe("kanał wejścia", () => {
  const c = (d: Parameters<typeof classifyChannel>[0]) => classifyChannel(d);
  it("Google Ads: g albo utm cpc; kampania z utm_campaign / gad_campaignid", () => {
    expect(c({ g: true, src: "google.com", utm: { utm_campaign: "alma", utm_term: "[Wynajem Lasera Alma]", utm_content: "111" } })).toMatchObject({ channel: TCH.GOOGLE_ADS, campaignKey: "alma", term: "wynajem lasera alma", group: "111" });
    expect(c({ utm: { utm_source: "google", utm_medium: "cpc", gad_campaignid: "24318571343" } })).toMatchObject({ channel: TCH.GOOGLE_ADS, campaignKey: "lightsheer" });
  });
  it("Google organiczne tylko bez g; Bing, Meta, Facebook / Instagram organiczne", () => {
    expect(c({ src: "www.google.pl" }).channel).toBe(TCH.GOOGLE_ORG);
    expect(c({ src: "www.google.pl", g: true }).channel).toBe(TCH.GOOGLE_ADS);
    expect(c({ src: "bing.com" }).channel).toBe(TCH.BING);
    expect(c({ m: true, src: "l.facebook.com" }).channel).toBe(TCH.META);
    expect(c({ utm: { utm_source: "meta", utm_campaign: "jesien" } })).toMatchObject({ channel: TCH.META, campaignKey: "jesien" });
    expect(c({ src: "l.facebook.com" }).channel).toBe(TCH.FACEBOOK);
    expect(c({ src: "l.instagram.com" }).channel).toBe(TCH.INSTAGRAM);
  });
  it("Meta: kampania, zestaw (utm_term) i reklama (utm_content) z prawdziwych znaczników; stare znaczniki = bez przypisania", () => {
    const real = c({ m: true, src: "instagram.com", utm: { utm_source: "meta", utm_medium: "paid_social", utm_campaign: "WL | LEADS | WYNAJEM | 10.2026", utm_term: "Rolki - Cold – send_form - LightSheer", utm_content: "LightSheer B", utm_id: "120248178026130384" } });
    expect(real).toMatchObject({ channel: TCH.META, campaignKey: "wl | leads | wynajem | 10.2026", group: "rolki - cold – send_form - lightsheer", term: "lightsheer b", groupLabel: "Rolki - Cold – send_form - LightSheer", termLabel: "LightSheer B" });
    expect(c({ m: true, utm: { utm_source: "fb", utm_medium: "paid", utm_campaign: "wynajem_leads_2026" } })).toMatchObject({ channel: TCH.META, campaignKey: "(meta-bez-przypisania)", group: null, term: null });
  });
  it("poczta, bezpośrednio, inne domeny, wewnętrzne", () => {
    expect(c({ src: "mail.google.com" }).channel).toBe(TCH.MAIL);
    expect(c({ utm: { utm_medium: "email" }, src: "" }).channel).toBe(TCH.MAIL);
    expect(c({ src: "" }).channel).toBe(TCH.DIRECT);
    expect(c({ src: "blog.example.com" }).channel).toBe(TCH.OTHER);
    expect(c({ src: "wynajemlasera.pl", prev: "/cennik/" }).channel).toBe(TCH.INTERNAL);
    expect(c({ src: "", prev: "/cennik/" }).channel).toBe(TCH.INTERNAL);
  });
});

describe("boty, limit, CORS", () => {
  it("boty po user-agencie; brak UA = bot", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (X11; Linux) HeadlessChrome/120")).toBe(true);
    expect(isBotUserAgent("python-requests/2.31")).toBe(true);
    expect(isBotUserAgent("curl/8.4.0")).toBe(false); // test endpointu po wdrożeniu
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1")).toBe(false);
  });
  it("limit 60 paczek na minutę z adresu, w pamięci; okno się odnawia", () => {
    const rl = createRateLimiter(60, 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i++) expect(rl.allow("ip1", t0 + i)).toBe(true);
    expect(rl.allow("ip1", t0 + 100)).toBe(false);
    expect(rl.allow("ip2", t0 + 100)).toBe(true);
    expect(rl.allow("ip1", t0 + 61_000)).toBe(true);
  });
  it("CORS: tylko wynajemlasera.pl; brak Origin (curl) przepuszczony", () => {
    const allowed = ["https://wynajemlasera.pl"];
    expect(originAllowed("https://wynajemlasera.pl", allowed)).toBe(true);
    expect(originAllowed("https://zly.example", allowed)).toBe(false);
    expect(originAllowed(null, allowed)).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("prywatność licznika (twarde wymagania etapu 2)", () => {
  const route = readFileSync(join(__dirname, "..", "..", "app", "api", "ruch", "route.ts"), "utf8");
  const store = readFileSync(join(__dirname, "store.ts"), "utf8");
  it("warstwa zapisu nie zna IP, user-agenta ani nagłówków", () => {
    expect(store).not.toMatch(/user-agent|x-forwarded|x-real-ip|headers|\bip\b/i);
  });
  it("trasa używa adresu tylko jako klucza limitu w pamięci, a user-agenta tylko do filtra botów; nic nie loguje", () => {
    expect(route.match(/headers\.get\("x-forwarded-for"\)/g)?.length).toBe(1);
    expect(route.match(/headers\.get\("user-agent"\)/g)?.length).toBe(1);
    expect(route).toContain("limiter.allow(key)");
    expect(route).toContain("isBotUserAgent(req.headers.get(\"user-agent\"))");
    // jedyne logowanie to błąd zapisu — bez ciała, nagłówków i adresu
    expect([...route.matchAll(/log(?:Info|Warn|Error)\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['"traffic_store_failed", err']);
    expect(route).not.toMatch(/prisma/);
  });
});
