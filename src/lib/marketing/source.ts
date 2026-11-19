// Wniosek 54, etap 1b: do jakiego kanału / kampanii / grupy / słowa należy sygnał.
// Czysty moduł (vitest bez „@/”). Kolejność wg decyzji Tomka (19.11):
//   1. last_* (utm / gclid / gbraid)  →  2. pierwsze wejście (utm / gclid / gbraid)
//   →  3. gad_campaignid / utm_id z landing_url  →  4. referrer (google, bing,
//   facebook, instagram, inna domena)  →  5. „Bez źródła”.
// Sygnał może nie mieć wszystkich pól — przypisujemy tak daleko, jak się da.

export type Attr = Record<string, string | string[]>;

export const CH = {
  GOOGLE_ADS: "Google Ads",
  META: "Meta reklamy",
  GOOGLE_ORG: "Google organiczne",
  BING: "Bing",
  FACEBOOK: "Facebook (organiczny)",
  INSTAGRAM: "Instagram (organiczny)",
  OTHER_SITE: "Inna strona",
  PHONE_EMAIL: "Telefon / e-mail",
  REFERRAL: "Polecenie",
  RETURNING: "Stała klientka",
  OLX: "OLX",
  MESSENGER: "Messenger",
  INSTAGRAM_DM: "Instagram Direct",
  NONE: "Bez źródła",
} as const;
export type Channel = (typeof CH)[keyof typeof CH];

// Kampanie Google Ads (konto 771-832-3719). Slug = wartość utm_campaign.
export const KNOWN_CAMPAIGNS: { key: string; id: string | null; label: string; hints: RegExp }[] = [
  { key: "lightsheer", id: "24318571343", label: "LightSheer", hints: /lightsheer|light\s*sheer/i },
  { key: "alma", id: "24313522296", label: "Alma", hints: /\balma\b/i },
  { key: "ogolne-lokalne", id: "24313246458", label: "Ogólne i lokalne", hints: /og[oó]ln|lokaln/i },
  { key: "pozostale", id: "24313246455", label: "Pozostałe", hints: /pozosta/i },
  { key: "marka", id: null, label: "Marka", hints: /\bmark[aię]|brand/i },
];

export type CampaignRef = { key: string; label: string };

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

// Parametry z adresu (landing_url bywa bez schematu / z fragmentem).
export function urlParams(url: string | null | undefined): Record<string, string> {
  const raw = (url ?? "").trim();
  const out: Record<string, string> = {};
  if (!raw.includes("?")) return out;
  const q = raw.slice(raw.indexOf("?") + 1).split("#")[0];
  for (const [k, v] of new URLSearchParams(q)) if (!(k.toLowerCase() in out)) out[k.toLowerCase()] = v.trim();
  return out;
}

// Wartość utm_campaign / numer z Google → kampania (klucz kanoniczny + etykieta).
export function campaignFrom(value: string | null | undefined): CampaignRef | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v || /^\{.*\}$/.test(v)) return null; // niepodstawiony szablon ValueTrack
  const byId = KNOWN_CAMPAIGNS.find((c) => c.id === v);
  if (byId) return { key: byId.key, label: byId.label };
  const bySlug = KNOWN_CAMPAIGNS.find((c) => c.key === v);
  if (bySlug) return { key: bySlug.key, label: bySlug.label };
  if (/^\d{6,}$/.test(v)) return { key: `id:${v}`, label: `kampania ${v}` };
  return { key: v, label: v };
}

// Nazwa kampanii z raportu kosztów (albo jej numer) → ta sama kampania co w sygnałach.
export function campaignFromCostName(name: string, id?: string | null): CampaignRef {
  const byId = id ? campaignFrom(id) : null;
  if (byId && !byId.key.startsWith("id:")) return byId;
  for (const c of KNOWN_CAMPAIGNS) if (c.hints.test(name)) return { key: c.key, label: c.label };
  if (byId) return { key: byId.key, label: name || byId.label };
  const k = name.trim().toLowerCase();
  return { key: k ? `nazwa:${k}` : "nieznana", label: name.trim() || "(bez nazwy)" };
}

// Nazwy z Mety (kampania, zestaw, reklama): bez wielkości liter, spacje zwinięte i obcięte na końcach.
export const normName = (v: string | null | undefined): string => (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// Meta: leady sprzed 28.10 mają stare znaczniki (fb/paid, wynajem_leads_2026, kolber_wideo…) — przypisujemy je
// tylko do kanału i okresu, bez dopasowania do reklamy.
export const META_UNASSIGNED: CampaignRef = { key: "(meta-bez-przypisania)", label: "Meta — bez przypisania do reklamy" };

export function normalizeKeyword(v: string | null | undefined): string {
  const s = (v ?? "").toLowerCase().replace(/[[\]"+]/g, " ").replace(/\s+/g, " ").trim();
  return /^\{.*\}$/.test(s) ? "" : s;
}

export type SourceStep = "last" | "first" | "landing_url" | "referrer" | "klient" | "typ" | "brak";

export type SourceInfo = {
  channel: Channel;
  campaign: CampaignRef | null;
  adGroup: string | null; // utm_content: Google = ID grupy, Meta = reklama
  keyword: string | null; // znormalizowane utm_term
  step: SourceStep;
  // Meta: oryginalne nazwy zestawu (adGroup) i reklamy (keyword) do wyświetlenia.
  adGroupLabel?: string | null;
  keywordLabel?: string | null;
  // Grupa i / lub słowo wzięte z pierwszego wejścia (ostatnie ma tę samą kampanię, ale bez utm_content / utm_term).
  fromFirst: boolean;
};

type Parts = { source: string; medium: string; campaign: string; content: string; term: string; gclid: string; gbraid: string; wbraid: string; fbclid: string };

function parts(attr: Attr, prefix: "last_" | ""): Parts {
  const g = (k: string) => one(attr[`${prefix}${k}`]);
  return {
    source: g("utm_source").toLowerCase(),
    medium: g("utm_medium").toLowerCase(),
    campaign: g("utm_campaign"),
    content: g("utm_content"),
    term: g("utm_term"),
    gclid: g("gclid"),
    gbraid: g("gbraid"),
    wbraid: g("wbraid"),
    fbclid: g("fbclid"),
  };
}

const META_SOURCES = ["meta", "facebook", "fb", "instagram", "ig", "facebook.com", "instagram.com"];

function channelFromUtm(p: Parts): Channel | null {
  const click = Boolean(p.gclid || p.gbraid || p.wbraid);
  if (p.source === "google" || p.source === "adwords" || p.source === "google ads") return p.medium === "organic" && !click ? CH.GOOGLE_ORG : CH.GOOGLE_ADS;
  if (META_SOURCES.includes(p.source)) return CH.META;
  if (p.source === "bing") return CH.BING;
  if (click) return CH.GOOGLE_ADS; // identyfikator Google bez znaczników utm
  if (p.source) return CH.OTHER_SITE;
  return null;
}

export function channelFromReferrer(referrer: string | null | undefined): Channel | null {
  const raw = (referrer ?? "").trim();
  if (!raw) return null;
  let host = "";
  try {
    host = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  if (!host || host.endsWith("wynajemlasera.pl")) return null; // nasza własna witryna
  if (/(^|\.)google\.[a-z.]+$/.test(host) || host === "googleadservices.com") return CH.GOOGLE_ORG;
  if (host.endsWith("bing.com")) return CH.BING;
  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com" || host === "l.facebook.com") return CH.FACEBOOK;
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return CH.INSTAGRAM;
  return CH.OTHER_SITE;
}

// Pochodzenie z pola „źródło” klienta (ClientSource) — dla sygnałów bez formularza.
export function channelFromClientSource(source: string | null | undefined): Channel | null {
  switch (source) {
    case "GOOGLE_ADS":
      return CH.GOOGLE_ADS;
    case "META":
      return CH.META;
    case "POLECENIE":
      return CH.REFERRAL;
    case "POWRACAJACY":
      return CH.RETURNING;
    case "TELEFON":
      return CH.PHONE_EMAIL;
    default:
      return null;
  }
}

export type SourceInput = {
  attribution: Attr | null;
  type: string; // LeadType
  clientSource?: string | null;
  // Dawne pola sygnału z importu HubSpota (utmSource / utmCampaign / gclid).
  legacy?: { utmSource: string | null; utmCampaign: string | null; gclid: string | null };
};

export function attributeSource(input: SourceInput): SourceInfo {
  const attr: Attr = { ...(input.attribution ?? {}) };
  if (input.legacy && !Object.keys(attr).length) {
    if (input.legacy.utmSource) attr.utm_source = input.legacy.utmSource;
    if (input.legacy.utmCampaign) attr.utm_campaign = input.legacy.utmCampaign;
    if (input.legacy.gclid) attr.gclid = input.legacy.gclid;
  }
  const url = urlParams(one(attr.landing_url));
  const first = parts(attr, "");
  const last = parts(attr, "last_");
  const urlCampaign = campaignFrom(url.gad_campaignid) ?? campaignFrom(url.utm_id);

  const clean = (v: string) => (v && !/^\{.*\}$/.test(v) ? v : "");
  const sameClick = (x: Parts, y: Parts) => (["gclid", "gbraid", "wbraid"] as const).some((k) => x[k] && x[k] === y[k]);
  const build = (channel: Channel, step: SourceStep, p: Parts): SourceInfo => {
    let campaign: CampaignRef | null = null;
    let adGroup: string | null = null;
    let keyword: string | null = null;
    let fromFirst = false;
    if (channel === CH.META) {
      // Nowy format znaczników Mety: utm_source=meta, utm_campaign = kampania, utm_term = zestaw reklam, utm_content = reklama.
      const camp = p.campaign.trim();
      let set = p.term.trim();
      let ad = p.content.trim();
      let usedFirst = false;
      if (step === "last" && camp && normName(camp) === normName(first.campaign)) {
        if (!set && first.term.trim()) {
          set = first.term.trim();
          usedFirst = true;
        }
        if (!ad && first.content.trim()) {
          ad = first.content.trim();
          usedFirst = true;
        }
      }
      const fresh = p.source === "meta" && camp.length > 0 && !/^\{.*\}$/.test(camp);
      if (!fresh) return { channel, campaign: META_UNASSIGNED, adGroup: null, keyword: null, step, fromFirst: false };
      return { channel, campaign: { key: normName(camp), label: camp }, adGroup: normName(set) || null, keyword: normName(ad) || null, adGroupLabel: set || null, keywordLabel: ad || null, step, fromFirst: usedFirst };
    }
    if (channel === CH.GOOGLE_ADS) {
      campaign = campaignFrom(p.campaign);
      adGroup = clean(p.content) || null;
      keyword = normalizeKeyword(p.term) || null;
      if (step === "last") {
        // Ostatnie wejście bez utm_content / utm_term, a pierwsze to ta sama kampania
        // (ten sam utm_campaign, gad_campaignid z adresu albo ten sam gclid / gbraid / wbraid)
        // — grupa i słowo z pierwszego wejścia.
        const fc = campaignFrom(first.campaign);
        const click = sameClick(p, first);
        const same = click || Boolean(campaign && ((fc && campaign.key === fc.key) || (urlCampaign && campaign.key === urlCampaign.key)));
        if (same) {
          if (!campaign && click && fc) campaign = fc;
          if (!adGroup && clean(first.content)) {
            adGroup = clean(first.content);
            fromFirst = true;
          }
          if (!keyword && normalizeKeyword(first.term)) {
            keyword = normalizeKeyword(first.term);
            fromFirst = true;
          }
        }
      }
      if (!campaign && channel === CH.GOOGLE_ADS) campaign = urlCampaign;
    }
    return { channel, campaign, adGroup, keyword, step, fromFirst };
  };

  // 1. ostatnie wejście, 2. pierwsze wejście
  const lastCh = channelFromUtm(last);
  if (lastCh) return build(lastCh, "last", last);
  const firstCh = channelFromUtm(first);
  if (firstCh) return build(firstCh, "first", first);
  // 3. gad_campaignid / utm_id z adresu wejścia
  if (urlCampaign || url.gclid || url.gbraid || url.wbraid) return { channel: CH.GOOGLE_ADS, campaign: urlCampaign, adGroup: null, keyword: null, step: "landing_url", fromFirst: false };
  // 4. referrer
  const ref = channelFromReferrer(one(attr.referrer));
  if (ref) return { channel: ref, campaign: null, adGroup: null, keyword: null, step: "referrer", fromFirst: false };
  if (first.fbclid || last.fbclid || url.fbclid) return { channel: CH.FACEBOOK, campaign: null, adGroup: null, keyword: null, step: "referrer", fromFirst: false };
  // Bez formularza WWW: źródło klienta albo rodzaj kontaktu.
  const fromClient = channelFromClientSource(input.clientSource);
  if (fromClient) return { channel: fromClient, campaign: null, adGroup: null, keyword: null, step: "klient", fromFirst: false };
  const byType: Record<string, Channel> = { TELEFON: CH.PHONE_EMAIL, EMAIL: CH.PHONE_EMAIL, OLX: CH.OLX, POLECENIE: CH.REFERRAL, MESSENGER: CH.MESSENGER, INSTAGRAM: CH.INSTAGRAM_DM };
  if (!input.attribution && byType[input.type]) return { channel: byType[input.type], campaign: null, adGroup: null, keyword: null, step: "typ", fromFirst: false };
  return { channel: CH.NONE, campaign: null, adGroup: null, keyword: null, step: "brak", fromFirst: false };
}
