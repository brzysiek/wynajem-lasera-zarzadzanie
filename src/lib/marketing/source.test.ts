import { describe, expect, it } from "vitest";
import { CH, attributeSource, campaignFrom, campaignFromCostName, channelFromReferrer, normalizeKeyword, urlParams } from "./source";

const www = (attribution: Record<string, string>, extra: Partial<Parameters<typeof attributeSource>[0]> = {}) => attributeSource({ attribution, type: "REZERWACJA_WWW", ...extra });

describe("kampanie", () => {
  it("slug, numer Google i nazwa z raportu kosztów trafiają w tę samą kampanię", () => {
    expect(campaignFrom("alma")).toEqual({ key: "alma", label: "Alma" });
    expect(campaignFrom("24313522296")).toEqual({ key: "alma", label: "Alma" });
    expect(campaignFrom("24318571343")?.key).toBe("lightsheer");
    expect(campaignFrom("24313246458")?.key).toBe("ogolne-lokalne");
    expect(campaignFrom("24313246455")?.key).toBe("pozostale");
    expect(campaignFrom("jakas-nowa")).toEqual({ key: "jakas-nowa", label: "jakas-nowa" });
    expect(campaignFrom("{campaignid}")).toBeNull();
    expect(campaignFromCostName("Wyszukiwanie – Alma Harmony").key).toBe("alma");
    expect(campaignFromCostName("Kampania 5", "24318571343").key).toBe("lightsheer");
    expect(campaignFromCostName("Ogólne i lokalne").key).toBe("ogolne-lokalne");
    expect(campaignFromCostName("Coś zupełnie innego").key).toBe("nazwa:coś zupełnie innego");
  });
  it("słowo kluczowe: bez znaków dopasowania, małe litery, niepodstawiony szablon = puste", () => {
    expect(normalizeKeyword('[Wynajem Lasera  Alma]')).toBe("wynajem lasera alma");
    expect(normalizeKeyword('"+wynajem +lasera"')).toBe("wynajem lasera");
    expect(normalizeKeyword("{keyword}")).toBe("");
  });
});

describe("przypisanie źródła — kolejność z decyzji Tomka", () => {
  it("1. ostatnie wejście wygrywa z pierwszym", () => {
    const r = www({ utm_source: "meta", utm_campaign: "wiosna", last_utm_source: "google", last_utm_campaign: "alma", last_gclid: "G" });
    expect(r.channel).toBe(CH.GOOGLE_ADS);
    expect(r.campaign?.key).toBe("alma");
    expect(r.step).toBe("last");
    expect(r.adGroup).toBeNull(); // pierwsze wejście było inną kampanią — grupy i słowa nie mieszamy
  });
  it("ostatnie wejście tej samej kampanii dostaje grupę i słowo z pierwszego", () => {
    const r = www({ utm_source: "google", utm_campaign: "alma", utm_content: "1234567", utm_term: "wynajem lasera alma", last_utm_source: "google", last_utm_campaign: "alma" });
    expect(r).toMatchObject({ channel: CH.GOOGLE_ADS, adGroup: "1234567", keyword: "wynajem lasera alma", step: "last" });
  });
  it("2. pierwsze wejście: utm Google → kampania, grupa, słowo", () => {
    const r = www({ utm_source: "google", utm_medium: "cpc", utm_campaign: "lightsheer", utm_content: "999", utm_term: "[wynajem lightsheer]" });
    expect(r).toMatchObject({ channel: CH.GOOGLE_ADS, adGroup: "999", keyword: "wynajem lightsheer", step: "first" });
    expect(r.campaign?.key).toBe("lightsheer");
  });
  it("Meta: kampania z utm_campaign, reklama z utm_content", () => {
    const r = www({ utm_source: "meta", utm_campaign: "jesien", utm_content: "reklama-1" });
    expect(r).toMatchObject({ channel: CH.META, adGroup: "reklama-1" });
    expect(r.campaign?.key).toBe("jesien");
  });
  it("gclid bez utm → Google Ads; kampania z gad_campaignid w landing_url", () => {
    const r = www({ gclid: "G1", landing_url: "https://wynajemlasera.pl/alma/?gad_campaignid=24313522296" });
    expect(r).toMatchObject({ channel: CH.GOOGLE_ADS });
    expect(r.campaign?.key).toBe("alma");
  });
  it("gbraid (iPhone) liczy się jak gclid", () => {
    expect(www({ gbraid: "0AAA", utm_source: "google", utm_campaign: "alma" }).channel).toBe(CH.GOOGLE_ADS);
    expect(www({ last_gbraid: "0AAA" }).channel).toBe(CH.GOOGLE_ADS);
  });
  it("3. sam gad_campaignid w adresie", () => {
    const r = www({ landing_url: "https://wynajemlasera.pl/?gad_campaignid=24318571343&gad_source=1" });
    expect(r).toMatchObject({ channel: CH.GOOGLE_ADS, step: "landing_url" });
    expect(r.campaign?.key).toBe("lightsheer");
  });
  it("4. referrer: google, bing, facebook, instagram, inna domena; własna strona ignorowana", () => {
    expect(www({ referrer: "https://www.google.com/" }).channel).toBe(CH.GOOGLE_ORG);
    expect(www({ referrer: "https://www.google.pl/search?q=x" }).channel).toBe(CH.GOOGLE_ORG);
    expect(www({ referrer: "https://www.bing.com/" }).channel).toBe(CH.BING);
    expect(www({ referrer: "https://l.facebook.com/l.php?u=x" }).channel).toBe(CH.FACEBOOK);
    expect(www({ referrer: "https://l.instagram.com/" }).channel).toBe(CH.INSTAGRAM);
    expect(www({ referrer: "https://blog.example.com/x" }).channel).toBe(CH.OTHER_SITE);
    expect(www({ referrer: "https://wynajemlasera.pl/cennik/" }).channel).toBe(CH.NONE);
    expect(channelFromReferrer("")).toBeNull();
  });
  it("5. nic nie ma → Bez źródła", () => {
    expect(www({ form: "kontakt" }).channel).toBe(CH.NONE);
    expect(www({ landing_url: "https://wynajemlasera.pl/", referrer: "" }).channel).toBe(CH.NONE);
  });
  it("sygnały bez formularza: źródło klienta, potem rodzaj kontaktu", () => {
    expect(attributeSource({ attribution: null, type: "TELEFON" }).channel).toBe(CH.PHONE_EMAIL);
    expect(attributeSource({ attribution: null, type: "EMAIL", clientSource: "POLECENIE" }).channel).toBe(CH.REFERRAL);
    expect(attributeSource({ attribution: null, type: "INNE", clientSource: "GOOGLE_ADS" }).channel).toBe(CH.GOOGLE_ADS);
    expect(attributeSource({ attribution: null, type: "POBRANIE_CENNIKA" }).channel).toBe(CH.NONE);
    expect(attributeSource({ attribution: null, type: "MESSENGER" }).channel).toBe(CH.MESSENGER);
  });
  it("stare pola z importu HubSpota, gdy brak atrybucji", () => {
    const r = attributeSource({ attribution: null, type: "POBRANIE_CENNIKA", legacy: { utmSource: "google", utmCampaign: "alma", gclid: null } });
    expect(r).toMatchObject({ channel: CH.GOOGLE_ADS });
    expect(r.campaign?.key).toBe("alma");
  });
  it("urlParams czyta adres bez schematu i z fragmentem", () => {
    expect(urlParams("wynajemlasera.pl/x?GAD_CampaignID=1#a")).toEqual({ gad_campaignid: "1" });
    expect(urlParams(null)).toEqual({});
  });
});
