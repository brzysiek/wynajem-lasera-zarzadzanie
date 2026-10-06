// Formularze Contact Form 7 na wynajemlasera.pl → sygnał panelu (03.10.2026),
// bez n8n i HubSpota. Wtyczka „CF7 to Webhook” wysyła pola formularza (JSON
// albo application/x-www-form-urlencoded). Czysty moduł (vitest bez „@/”):
// parsowanie treści żądania i mapowanie pól; puste / nieznane wartości dat
// i dni NIE wywracają zapisu (słabość n8n) — dają null.
import { interestsFromText } from "../history/invoices";
import type { DeviceInterestKey } from "../clients/labels";
import type { LeadTypeKey } from "./parse-deal";

export const WWW_TYPE: Record<string, LeadTypeKey> = {
  cennik: "POBRANIE_CENNIKA",
  kontakt: "KONTAKT",
  "rezerwacja-wynajmu": "REZERWACJA_WWW",
  "rezerwacja-szkolenia": "SZKOLENIE_WWW",
};

// Atrybucja z formularza (wniosek 41): utm_*/gclid/fbclid = pierwsze wejście,
// last_* = ostatnie wejście przed formularzem, fbp/fbc = identyfikatory z
// cookies Meta (tylko za zgodą, patrz CONSENT_KEYS). Pole puste jest pomijane,
// wartość do 500 znaków; nieznane pola formularza są ignorowane bez błędu.
export const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "last_gclid",
  "last_fbclid",
  "last_utm_source",
  "last_utm_campaign",
  "fbp",
  "fbc",
  "landing_url",
  "referrer",
] as const;

// Identyfikatory Meta zapisujemy wyłącznie, gdy formularz przekazał zgodę
// (pole acceptance-* zaznaczone) — RODO. Bez zgody pomijamy je w sygnale i
// usuwamy z logu surowych danych (redactForLog).
export const CONSENT_KEYS = ["fbp", "fbc"] as const;

export function hasConsent(body: Record<string, unknown>): boolean {
  const on = (v: unknown): boolean => (Array.isArray(v) ? v.some(on) : !["", "0", "false", "off", "nie", "no", "null"].includes(String(v ?? "").trim().toLowerCase()));
  return Object.entries(body).some(([k, v]) => k.startsWith("acceptance") && on(v));
}

// Surowe dane do logu webhooka: bez fbp/fbc, gdy nie było zgody.
export function redactForLog(body: Record<string, unknown>): Record<string, unknown> {
  if (hasConsent(body)) return body;
  const copy = { ...body };
  for (const k of CONSENT_KEYS) delete copy[k];
  return copy;
}

export type WwwForm = {
  rawType: string;
  type: LeadTypeKey;
  name: string | null;
  phone: string | null; // surowy — normalizuje wywołujący
  email: string | null;
  company: string | null;
  message: string | null; // wiadomość + firma + miejscowość + data szkolenia
  devices: DeviceInterestKey[];
  devicesText: string | null; // urządzenia tak, jak wybrała klientka
  city: string | null; // pole „miejscowosc” (rezerwacja)
  dateFromRaw: string | null; // surowe contact-date-from — do maila potwierdzającego
  daysRaw: string | null; // surowe contact-days, np. „tydzień (Observ)"
  requestedFrom: string | null; // RRRR-MM-DD
  requestedDays: number | null;
  courseDate: string | null;
  attribution: Record<string, string | string[]>;
  test: boolean; // e-mail test+www-…@wynajemlasera.pl (sprawdzenie po wdrożeniu)
};

type Body = Record<string, unknown>;

// Treść żądania: JSON albo formularz (także „pole[]” dla checkboxów).
export function parseWebhookBody(contentType: string | null, raw: string): Body {
  const text = raw.trim();
  if (!text) return {};
  if ((contentType ?? "").includes("json") || text.startsWith("{")) {
    try {
      const v = JSON.parse(text);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Body) : {};
    } catch {
      // nie-JSON mimo nagłówka — spróbujmy jak formularz
    }
  }
  const out: Body = {};
  for (const [k0, v] of new URLSearchParams(text)) {
    const k = k0.replace(/\[\]$/, "");
    const prev = out[k];
    out[k] = prev === undefined ? (k0.endsWith("[]") ? [v] : v) : Array.isArray(prev) ? [...prev, v] : [String(prev), v];
  }
  return out;
}

const str = (v: unknown): string | null => {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean).join(", ") || null;
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : String(v).split(/[,;\n]/)).map((x) => String(x ?? "").trim()).filter(Boolean);

export function parseDays(v: unknown): number | null {
  const s = (str(v) ?? "").toLowerCase();
  if (!s) return null;
  if (/2\s*tygodn/.test(s)) return 14;
  if (/tydzie|tygodn/.test(s)) return 7;
  const n = s.match(/^(\d{1,2})\s*(dzie|dni|d\b|$)/);
  if (n) {
    const d = Number(n[1]);
    return [1, 2, 3, 7, 14].includes(d) ? d : null;
  }
  return null;
}

export function parseDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(`${s}T12:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
  }
  const pl = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (pl) return parseDate(`${pl[3]}-${pl[2].padStart(2, "0")}-${pl[1].padStart(2, "0")}`);
  return null;
}

export function parseWwwForm(body: Body): WwwForm {
  const rawType = (str(body.text) ?? "").toLowerCase();
  const type = WWW_TYPE[rawType] ?? "INNE";
  // Rezerwacja wysyła contact-device; formularz cennika — pole „urzadzenie”.
  const devicesList = [...list(body["contact-device"]), ...list(body["urzadzenie"])];
  const devicesText = devicesList.length ? devicesList.join(", ") : null;
  const devices = [...new Set(interestsFromText(devicesText).filter((d) => d !== "SZKOLENIE"))] as DeviceInterestKey[];
  const email = str(body["contact-email"])?.toLowerCase() ?? null;
  const company = str(body["contact-company-name"]);
  const courseDate = str(body["contact-course-date"]);
  const msg = str(body["contact-message"]);
  // Miejscowość: pole „miejscowosc”, a gdy go brak — linia „Miejscowość: …”
  // wpisana w wiadomość (formularz v2 składa wiadomość sam). Linii nie
  // dublujemy w treści sygnału (wniosek 39).
  const msgCityLine = msg?.match(/^[ \t]*Miejscowo[sś][cć][ \t]*[:\-][ \t]*(.+)$/im)?.[1]?.trim() || null;
  const city = str(body["miejscowosc"]) ?? msgCityLine;
  const message =
    [
      msg,
      company ? `Firma: ${company}` : null,
      city && !msgCityLine ? `Miejscowość: ${city}` : null,
      courseDate ? `Termin szkolenia: ${courseDate}` : null,
      type === "INNE" && rawType ? `Formularz: ${rawType}` : null,
    ]
      .filter(Boolean)
      .join("\n") || null;
  const attribution: Record<string, string | string[]> = {};
  const consent = hasConsent(body);
  for (const k of ATTRIBUTION_KEYS) {
    if (!consent && (CONSENT_KEYS as readonly string[]).includes(k)) continue;
    const v = str(body[k]);
    if (v) attribution[k] = v.slice(0, 500);
  }
  for (const [k, v] of Object.entries(body)) {
    if (k.startsWith("acceptance")) attribution[k] = Array.isArray(v) ? v.map(String) : String(v ?? "");
  }
  if (rawType) attribution.form = rawType;
  return {
    rawType,
    type,
    name: str(body["contact-name"]),
    phone: str(body["contact-phone"]),
    email,
    company,
    message: message?.slice(0, 5000) ?? null,
    devices,
    devicesText,
    city,
    dateFromRaw: str(body["contact-date-from"]),
    daysRaw: str(body["contact-days"]),
    requestedFrom: parseDate(body["contact-date-from"]),
    requestedDays: parseDays(body["contact-days"]),
    courseDate,
    attribution,
    test: !!email && /^test\+www-/.test(email),
  };
}

// Klucz treści zgłoszenia (wniosek 39): to samo zgłoszenie wysłane drugi raz
// (podwójne kliknięcie, ponowienie wtyczki) ma ten sam klucz; zmieniony sprzęt,
// termin, liczba dni albo wiadomość (w niej firma i miejscowość) — inny.
// Składany z pól już znormalizowanych, więc identyczny dla formularza i dla
// zapisanego sygnału.
export function contentKey(c: { devices: string[]; from: string | null; days: number | null; message: string | null }): string {
  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 5000);
  return JSON.stringify([[...new Set(c.devices)].sort(), c.from ?? null, c.days ?? null, norm(c.message)]);
}

// Klucz idempotencji (06.10.2026): identyfikator zgłoszenia nadany przez
// WordPress (nowe pole zgloszenie_id) — przy ponawianiu webhooka to samo
// zgłoszenie nie utworzy drugiego sygnału, bez względu na upływ czasu.
export function extractExternalId(body: Record<string, unknown>): string | null {
  const v = body["zgloszenie_id"];
  const s = Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" || typeof v === "number" ? String(v) : "";
  const t = s.trim().slice(0, 100);
  return /^[\w.:\-]{3,100}$/.test(t) ? t : null;
}

// Token: ?token= (wtyczka CF7 może nie umieć nagłówków) albo nagłówek
// x-webhook-token / Authorization: Bearer. Porównanie stałoczasowe.
export function tokenMatches(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
