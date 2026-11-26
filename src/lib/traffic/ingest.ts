// Wniosek 54, etap 2: anonimowy licznik ruchu — przyjmowanie paczek ze strony
// (navigator.sendBeacon, text/plain z JSON). Czysty moduł (vitest bez „@/”):
// walidacja i przycinanie, klasyfikacja kanału wejścia, filtr botów, limit w pamięci.
//
// PRYWATNOŚĆ (twarde wymagania): nie zapisujemy IP, user-agenta, nagłówków ani niczego, co
// identyfikuje osobę. IP wolno użyć wyłącznie w pamięci do limitu paczek; user-agent
// sprawdzamy w locie (filtr botów) i nigdzie nie zapisujemy. Nic z tego nie trafia do logów.
import { CH, META_UNASSIGNED, campaignFrom, normName, normalizeKeyword } from "../marketing/source";

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_EVENTS = 50;
export const RATE_LIMIT_PER_MIN = 60;

export const DEVICES = ["telefon", "tablet", "komputer"] as const;
export const EVENT_TYPES = ["wejscie", "klik", "form_start", "form_proba", "form_wyslany", "form_blad", "form_porzucony", "form_otwarty", "baner_pokazany", "baner_wybor", "koniec"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const CLICK_KINDS = ["telefon", "email", "link_wewn", "link_zewn", "menu", "plik", "przycisk", "inne"] as const;
export const CONSENT_STATES = ["s1m1", "s1m0", "s0m0", "brak"] as const;
export const BANNER_CHOICES = ["wszystkie", "wlasny", "odrzucam"] as const;
export const SCROLL_STEPS = [0, 25, 50, 75, 100] as const;
export const TIME_BUCKETS = ["<10s", "10-30s", "30s-2min", ">2min"] as const;
// Skrypt licznika v2 (wniosek 60): czas aktywny w sekundach i sekundy w 10 pasach wysokości strony.
export const MAX_SECONDS = 1800;
export const BAND_COUNT = 10;
export const MIN_VISITS = 20; // poniżej: „mało danych” (raporty jakości ruchu i mapa uwagi)

// Kanały ruchu. Te same nazwy co w raporcie leadów (CH), żeby dało się je łączyć.
export const TCH = {
  GOOGLE_ADS: CH.GOOGLE_ADS,
  GOOGLE_ORG: CH.GOOGLE_ORG,
  BING: CH.BING,
  META: CH.META,
  FACEBOOK: CH.FACEBOOK,
  INSTAGRAM: CH.INSTAGRAM,
  MAIL: "Poczta",
  DIRECT: "Bezpośrednio",
  OTHER: "Inne domeny",
  INTERNAL: "Wewnętrzne", // przejście między stronami naszej witryny — nie jest nowym wejściem
  UNKNOWN: "Nieznany",
} as const;

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "gad_campaignid"] as const;

export type ParsedEvent = { type: EventType; t: number | null; data: Record<string, unknown> };
export type ParsedBeacon = { pv: string; path: string; dev: string; events: ParsedEvent[] };

// Przycięcie do `max` znaków; nie zostawia połówki znaku spoza BMP (osierocony surrogat psuje JSON w bazie).
const str = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  let out = v.trim().slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
};
const truthy = (v: unknown): boolean => v === true || v === 1 || v === "1" || v === "true";
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null);
const num = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
// Liczba całkowita w zakresie — poza zakresem albo ułamek = odrzucenie (null), nie przycinanie.
const intIn = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
// Dokładnie 10 liczb całkowitych 0–1800; cokolwiek innego = null (zdarzenie zapisujemy bez pola).
export function parseBands(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== BAND_COUNT) return null;
  const out = v.map((x) => intIn(x, 0, MAX_SECONDS));
  return out.every((x): x is number => x !== null) ? out : null;
}

// Skrypt v3 (24.11.2026): rodzaj kliknięcia Google Ads w polu `gt` zdarzenia „wejscie” — tylko rodzaj, nigdy wartość
// identyfikatora. Dozwolone: gclid, gbraid, wbraid i połączenia przez „+” (np. gclid+gbraid); reszta = null.
export const CLICK_KIND_PARTS = ["gclid", "gbraid", "wbraid"] as const;
export const MAX_GT_LENGTH = 30;
export function parseClickKind(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.trim().toLowerCase();
  if (!raw || raw.length > MAX_GT_LENGTH) return null;
  const parts = raw.split("+");
  if (!parts.every((p) => (CLICK_KIND_PARTS as readonly string[]).includes(p))) return null;
  // Stała kolejność i bez powtórzeń: „wbraid+gclid” i „gclid+wbraid” to ten sam rodzaj.
  const uniq = CLICK_KIND_PARTS.filter((p) => parts.includes(p));
  return uniq.join("+");
}

function parseEvent(raw: unknown): ParsedEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const type = pick(o.e, EVENT_TYPES);
  if (!type) return null; // nieznane typy odrzucamy
  const t = num(o.t, 0, 86_400);
  const data: Record<string, unknown> = {};
  switch (type) {
    case "wejscie": {
      data.src = str(o.src, 80).toLowerCase();
      data.prev = str(o.prev, 200);
      const utm: Record<string, string> = {};
      const u = o.utm && typeof o.utm === "object" && !Array.isArray(o.utm) ? (o.utm as Record<string, unknown>) : {};
      for (const k of UTM_KEYS) {
        const v = str(u[k], 120);
        if (v) utm[k] = v;
      }
      data.utm = utm;
      data.g = truthy(o.g);
      data.gt = parseClickKind(o.gt); // v3; wcześniejsze wejścia nie mają tego pola → brak danych
      data.m = truthy(o.m);
      data.zgoda = pick(o.zgoda, CONSENT_STATES) ?? "brak";
      break;
    }
    case "klik": {
      data.rodzaj = pick(o.rodzaj, CLICK_KINDS) ?? "inne";
      data.etyk = str(o.etyk, 40);
      data.x = num(o.x, 0, 100);
      data.y = num(o.y, 0, 100_000);
      break;
    }
    case "form_start":
    case "form_proba":
    case "form_wyslany":
    case "form_otwarty": // wniosek 63: okno zapytania otwarte (odsłona, na której formularz 6252 faktycznie pokazano)
      data.form = str(o.form, 40);
      break;
    case "form_blad":
      data.form = str(o.form, 40);
      data.pola = (Array.isArray(o.pola) ? o.pola : []).slice(0, 10).map((x) => str(x, 40)).filter(Boolean);
      break;
    case "form_porzucony":
      data.form = str(o.form, 40);
      data.pole = str(o.pole, 40);
      data.bledy = num(o.bledy, 0, 50) ?? 0;
      break;
    case "baner_pokazany":
      break;
    case "baner_wybor":
      data.wybor = pick(o.wybor, BANNER_CHOICES);
      data.zgoda = pick(o.zgoda, CONSENT_STATES) ?? "brak";
      if (!data.wybor) return null;
      break;
    case "koniec":
      data.przew = typeof o.przew === "number" && (SCROLL_STEPS as readonly number[]).includes(o.przew) ? o.przew : 0;
      data.czas = pick(o.czas, TIME_BUCKETS) ?? "<10s";
      data.wyjscie = truthy(o.wyjscie);
      // v2: pola dodajemy tylko, gdy przeszły walidację (stare paczki ich nie mają).
      {
        const sek = intIn(o.sek, 0, MAX_SECONDS);
        if (sek !== null) data.sek = sek;
        const pasy = parseBands(o.pasy);
        if (pasy) data.pasy = pasy;
      }
      break;
  }
  return { type, t, data };
}

export type ParseResult = { ok: true; beacon: ParsedBeacon } | { ok: false; reason: "too_large" | "bad_json" | "bad_shape" | "empty" };

// Ciało paczki (text/plain z JSON). Odrzuca za duże, niepoprawne i puste; przycina teksty,
// ucina do MAX_EVENTS i pomija nieznane zdarzenia.
export function parseBeacon(body: string): ParseResult {
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return { ok: false, reason: "too_large" };
  let j: unknown;
  try {
    j = JSON.parse(body);
  } catch {
    return { ok: false, reason: "bad_json" };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, reason: "bad_shape" };
  const o = j as Record<string, unknown>;
  const pv = str(o.pv, 40);
  const path = str(o.path, 200);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(pv) || !path.startsWith("/")) return { ok: false, reason: "bad_shape" };
  if (!Array.isArray(o.ev)) return { ok: false, reason: "bad_shape" };
  const events = o.ev.slice(0, MAX_EVENTS).map(parseEvent).filter((e): e is ParsedEvent => e !== null);
  if (!events.length) return { ok: false, reason: "empty" };
  const dev = pick(o.dev, DEVICES) ?? "nieznane";
  return { ok: true, beacon: { pv, path: path.split("?")[0].split("#")[0] || "/", dev, events } };
}

// ---------------------------------------------------------------- kanał wejścia

const OWN_HOSTS = ["wynajemlasera.pl"];
const hostOf = (src: string): string => src.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

// Google Ads: campaignKey = kampania (slug), group = ID grupy (utm_content), term = fraza (utm_term).
// Meta: campaignKey = kampania (nazwa), group = zestaw reklam (utm_term), term = reklama (utm_content);
// *Label to oryginalne nazwy. Znaczniki sprzed nowego formatu Mety → „bez przypisania do reklamy”.
export type ChannelInfo = { channel: string; campaignKey: string | null; campaign: string | null; term: string | null; group: string | null; termLabel?: string | null; groupLabel?: string | null };

// Kanał wejścia z pola wejscie: g (kliknięcie Google Ads), m (kliknięcie Meta), src (domena odsyłająca), utm.
export function classifyChannel(d: { src?: string; prev?: string; utm?: Record<string, string>; g?: boolean; m?: boolean }): ChannelInfo {
  const utm = d.utm ?? {};
  const src = hostOf(d.src ?? "");
  const source = (utm.utm_source ?? "").toLowerCase();
  const medium = (utm.utm_medium ?? "").toLowerCase();
  const camp = campaignFrom(utm.utm_campaign) ?? campaignFrom(utm.gad_campaignid) ?? campaignFrom(utm.utm_id);
  const out = (channel: string, withCampaign = false): ChannelInfo => ({
    channel,
    campaignKey: withCampaign ? (camp?.key ?? null) : null,
    campaign: withCampaign ? (camp?.label ?? null) : null,
    term: withCampaign ? normalizeKeyword(utm.utm_term) || null : null,
    group: withCampaign ? utm.utm_content || null : null,
  });
  // Przejście w obrębie witryny (prev z naszej strony albo odsyłacz z własnej domeny) — nie nowe wejście.
  if (d.prev || OWN_HOSTS.some((h) => src === h || src.endsWith(`.${h}`))) return out(TCH.INTERNAL);
  if (d.g || ((source === "google" || source === "adwords") && (medium === "cpc" || medium === "ppc" || medium === "paid"))) return out(TCH.GOOGLE_ADS, true);
  if (d.m || ["meta", "fb", "ig", "facebook", "instagram"].includes(source)) {
    const camp = (utm.utm_campaign ?? "").trim();
    if (source === "meta" && camp && !/^\{.*\}$/.test(camp)) {
      return { channel: TCH.META, campaignKey: normName(camp), campaign: camp, group: normName(utm.utm_term) || null, groupLabel: (utm.utm_term ?? "").trim() || null, term: normName(utm.utm_content) || null, termLabel: (utm.utm_content ?? "").trim() || null };
    }
    return { channel: TCH.META, campaignKey: META_UNASSIGNED.key, campaign: META_UNASSIGNED.label, group: null, term: null };
  }
  if (medium === "email" || source === "email" || source === "newsletter" || /^(mail|poczta|webmail|outlook|mail\.google|mail\.yahoo)/.test(src) || src.endsWith("mail.google.com") || src.endsWith("outlook.live.com")) return out(TCH.MAIL);
  if (/(^|\.)google\.[a-z.]+$/.test(src)) return out(TCH.GOOGLE_ORG);
  if (src.endsWith("bing.com")) return out(TCH.BING);
  if (src === "facebook.com" || src.endsWith(".facebook.com") || src === "fb.com" || src === "l.facebook.com") return out(TCH.FACEBOOK);
  if (src === "instagram.com" || src.endsWith(".instagram.com")) return out(TCH.INSTAGRAM);
  if (!src) return out(TCH.DIRECT);
  return out(TCH.OTHER);
}

// Zdarzenia testowe skryptu (utm_campaign=test-licznik-…, np. test-licznik-v3) nie wchodzą do żadnego raportu —
// pomijamy całą odsłonę (pv), na której wejście miało taką kampanię. Niczego nie kasujemy z bazy.
export const TEST_CAMPAIGN_PREFIX = "test-licznik";
export function dropTestEvents<T extends { pv: string; type: string; data: Record<string, unknown> | null }>(rows: T[]): T[] {
  const testPvs = new Set<string>();
  for (const r of rows) {
    if (r.type !== "wejscie") continue;
    const utm = r.data?.utm;
    const camp = utm && typeof utm === "object" && !Array.isArray(utm) ? (utm as Record<string, unknown>).utm_campaign : null;
    if (typeof camp === "string" && camp.trim().toLowerCase().startsWith(TEST_CAMPAIGN_PREFIX)) testPvs.add(r.pv);
  }
  return testPvs.size ? rows.filter((r) => !testPvs.has(r.pv)) : rows;
}

// ---------------------------------------------------------------- boty i limity

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|facebookexternalhit|preview|python-requests|python-urllib|java\/|go-http|okhttp|axios|node-fetch|httpclient|scrapy|phantom|selenium|puppeteer|playwright|postman|libwww/i;

// Znane boty i automaty po user-agencie (sprawdzane w locie, niczego nie zapisujemy). Brak UA = bot.
// curl / wget NIE są filtrowane — służą do sprawdzenia endpointu po wdrożeniu (limit 60/min i tak obowiązuje).
export function isBotUserAgent(ua: string | null | undefined): boolean {
  const s = (ua ?? "").trim();
  return !s || BOT_UA.test(s);
}

// Limit paczek na minutę z jednego adresu — wyłącznie w pamięci procesu (bez zapisu).
export function createRateLimiter(limit = RATE_LIMIT_PER_MIN, windowMs = 60_000) {
  const hits = new Map<string, { n: number; reset: number }>();
  return {
    allow(key: string, now = Date.now()): boolean {
      const cur = hits.get(key);
      if (!cur || now >= cur.reset) {
        hits.set(key, { n: 1, reset: now + windowMs });
        if (hits.size > 5000) for (const [k, v] of hits) if (now >= v.reset) hits.delete(k);
        return true;
      }
      cur.n++;
      return cur.n <= limit;
    },
    size: () => hits.size,
  };
}

// CORS: tylko strona (domyślnie https://wynajemlasera.pl); brak nagłówka Origin (np. curl) przepuszczamy.
export function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return true;
  return allowed.includes(origin);
}
