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

export const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "landing_url", "referrer"] as const;

export type WwwForm = {
  rawType: string;
  type: LeadTypeKey;
  name: string | null;
  phone: string | null; // surowy — normalizuje wywołujący
  email: string | null;
  company: string | null;
  message: string | null; // wiadomość + firma + data szkolenia
  devices: DeviceInterestKey[];
  devicesText: string | null;
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
  const devicesList = list(body["contact-device"]);
  const devicesText = devicesList.length ? devicesList.join(", ") : null;
  const devices = [...new Set(interestsFromText(devicesText).filter((d) => d !== "SZKOLENIE"))] as DeviceInterestKey[];
  const email = str(body["contact-email"])?.toLowerCase() ?? null;
  const company = str(body["contact-company-name"]);
  const courseDate = str(body["contact-course-date"]);
  const msg = str(body["contact-message"]);
  const message = [msg, company ? `Firma: ${company}` : null, courseDate ? `Termin szkolenia: ${courseDate}` : null, type === "INNE" && rawType ? `Formularz: ${rawType}` : null].filter(Boolean).join("\n") || null;
  const attribution: Record<string, string | string[]> = {};
  for (const k of ATTRIBUTION_KEYS) {
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
    requestedFrom: parseDate(body["contact-date-from"]),
    requestedDays: parseDays(body["contact-days"]),
    courseDate,
    attribution,
    test: !!email && /^test\+www-/.test(email),
  };
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
