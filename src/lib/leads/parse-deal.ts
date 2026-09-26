// Parser transakcji z HubSpota → sygnał panelu (CRM, prompt 2, 2.3).
// Mapowanie ustalone na prawdziwych danych i potwierdzone przez użytkownika
// (26.09.2026):
//   - typ i e-mail z nazwy: „WWW - pobranie cennika|kontakt|rezerwacja wynajmu - <e-mail>”;
//     bez przedrostka „WWW” = transakcja dodana ręcznie po telefonie;
//   - telefon z właściwości `telefon_z_szansy`, awaryjnie „telefon: …” z opisu;
//   - rezerwacja: opis w stałym formacie
//     „Imię i nazwisko: …, Urządzenia: …, Wynajem od: RRRR-MM-DD, Dni: N dni, Wiadomość: …, telefon: …”;
//   - kontakt: opis „treść wiadomości - Imię”.
// Czyste funkcje bez zależności (vitest bez aliasu "@/").
import { interestsFromText } from "../history/invoices";
import type { DeviceInterestKey } from "../clients/labels";

export type LeadTypeKey = "POBRANIE_CENNIKA" | "KONTAKT" | "REZERWACJA_WWW" | "SZKOLENIE_WWW" | "TELEFON" | "EMAIL" | "INNE";
export type LeadStageKey = "SYGNAL" | "WYWIAD" | "OFERTA" | "REZERWACJA" | "WYGRANA" | "PRZEGRANA";

const EMAIL_RE = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/i;

export function parseDealName(name: string): { type: LeadTypeKey; email: string | null; fromForm: boolean } {
  const email = name.match(EMAIL_RE)?.[0].toLowerCase() ?? null;
  const m = name.match(/^\s*WWW\s*-\s*(.+?)\s*-\s*\S+@\S+\s*$/i);
  if (!m) return { type: "TELEFON", email, fromForm: false };
  const kind = m[1].toLowerCase();
  const type: LeadTypeKey = kind.includes("cennik")
    ? "POBRANIE_CENNIKA"
    : kind.includes("rezerwacj")
      ? "REZERWACJA_WWW"
      : kind.includes("szkolen")
        ? "SZKOLENIE_WWW"
        : kind.includes("kontakt")
          ? "KONTAKT"
          : "INNE";
  return { type, email, fromForm: true };
}

export type ParsedDescription = {
  personName: string | null;
  devicesText: string | null;
  devices: DeviceInterestKey[];
  requestedFrom: string | null; // RRRR-MM-DD
  requestedDays: number | null;
  message: string | null;
  phone: string | null; // surowy — normalizuje wywołujący
};

const EMPTY: ParsedDescription = {
  personName: null,
  devicesText: null,
  devices: [],
  requestedFrom: null,
  requestedDays: null,
  message: null,
  phone: null,
};

const LABELS = ["Imię i nazwisko", "Urządzenia", "Wynajem od", "Dni", "Wiadomość", "telefon"] as const;

// Wiadomość może zawierać przecinki i nowe linie, więc pola wycinamy po
// pozycjach znanych etykiet, nie po przecinkach.
function splitLabelled(text: string): Partial<Record<(typeof LABELS)[number], string>> {
  const found: { label: (typeof LABELS)[number]; at: number; valueAt: number }[] = [];
  for (const label of LABELS) {
    const re = new RegExp(`(^|,\\s*)${label}:\\s?`, "i");
    const m = re.exec(text);
    if (m) found.push({ label, at: m.index, valueAt: m.index + m[0].length });
  }
  found.sort((a, b) => a.at - b.at);
  const out: Partial<Record<(typeof LABELS)[number], string>> = {};
  found.forEach((f, i) => {
    const end = i + 1 < found.length ? found[i + 1].at : text.length;
    out[f.label] = text.slice(f.valueAt, end).trim();
  });
  return out;
}

const clean = (s: string | undefined | null) => {
  const t = (s ?? "").replace(/\r\n/g, "\n").trim();
  return t ? t : null;
};

export function parseDealDescription(type: LeadTypeKey, description: string | null | undefined): ParsedDescription {
  const text = clean(description);
  if (!text) return { ...EMPTY };

  if (/Imię i nazwisko:/i.test(text) && /Urządzenia:/i.test(text)) {
    const f = splitLabelled(text);
    const days = f.Dni?.match(/\d+/)?.[0];
    const date = f["Wynajem od"]?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    return {
      personName: clean(f["Imię i nazwisko"]),
      devicesText: clean(f["Urządzenia"]),
      devices: interestsFromText(f["Urządzenia"]).filter((d) => d !== "SZKOLENIE"),
      requestedFrom: date,
      requestedDays: days ? Number(days) : null,
      message: clean(f["Wiadomość"]),
      phone: clean(f.telefon),
    };
  }

  // „treść - Imię” z formularza kontaktowego (także przy ręcznych
  // transakcjach, gdzie Ania wkleiła wiadomość z formularza).
  const m = text.match(/^([\s\S]*?)\s+-\s+([^\n-]{2,60})$/);
  const message = m ? clean(m[1]) : text;
  return {
    ...EMPTY,
    personName: m && type !== "TELEFON" ? clean(m[2]) : null,
    message,
    devices: interestsFromText(message).filter((d) => d !== "SZKOLENIE"),
  };
}

// Lejek HubSpot „Proces sprzedaży” (pipeline = default) → etap panelu.
// Identyfikatory weryfikowane przez API przy imporcie (hubspot-deals.ts).
export const HUBSPOT_STAGE_TO_LEAD: Record<string, LeadStageKey> = {
  "3115771105": "SYGNAL", // Sygnał
  appointmentscheduled: "WYWIAD", // Szansa
  qualifiedtobuy: "OFERTA", // Wywiad/oferta
  presentationscheduled: "REZERWACJA", // Akceptacja/rezerwacja
  "3080529125": "REZERWACJA", // Wysłany kontrakt
  closedwon: "WYGRANA",
  closedlost: "PRZEGRANA",
  "3211592907": "PRZEGRANA", // Zamrażalnik
};
export const HUBSPOT_FREEZER_STAGE = "3211592907";
export const HUBSPOT_SIGNAL_STAGE = "3115771105";

// Notatka HubSpot (HTML) → zwykły tekst na oś czasu.
export function noteHtmlToText(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Które transakcje importujemy (prompt 2, 2.3): lejek „default”; od
// 01.09.2025 wszystkie, starsze tylko poza etapem „Sygnał” (reszta to
// archiwum importu — zostaje w HubSpocie).
export const IMPORT_FROM = new Date("2025-09-01T00:00:00Z");

export function shouldImportDeal(p: Record<string, string | null>): boolean {
  if ((p.pipeline ?? "default") !== "default") return false;
  const created = p.createdate ? new Date(p.createdate) : null;
  if (!created || Number.isNaN(created.getTime())) return false;
  return created >= IMPORT_FROM || p.dealstage !== HUBSPOT_SIGNAL_STAGE;
}

export const LEAD_DEVICE_LABEL: Record<string, string> = {
  LIGHTSHEER: "LightSheer",
  LIGHTSHEER_ET400: "ET400",
  ALMA_HARMONY: "Alma",
  COOLTECH: "Cooltech",
  RESURFX: "ResurFX",
  OBSERV: "Observ",
};

export type PlannedLead = {
  type: LeadTypeKey;
  stage: LeadStageKey;
  title: string;
  email: string | null;
  phone: string | null; // E.164
  personName: string | null;
  devices: DeviceInterestKey[];
  requestedFrom: Date | null;
  requestedDays: number | null;
  message: string | null;
  lostReason: "INNE" | null;
  lostNote: string | null;
  createdAt: Date;
  stageChangedAt: Date;
  fromForm: boolean;
};

// Czytelny tytuł: „Kto — Urządzenie N dni”. Kto = nazwa klienta (gdy
// znana), osoba z formularza albo e-mail; ręczne transakcje zostają przy
// nazwie nadanej przez Anię.
export function leadTitle(input: { who: string | null; devices: DeviceInterestKey[]; days: number | null; fallback: string }): string {
  const who = input.who?.trim() || input.fallback;
  const dev = input.devices.map((d) => LEAD_DEVICE_LABEL[d]).filter(Boolean).join(", ");
  const extra = [dev, input.days ? `${input.days} ${input.days === 1 ? "dzień" : "dni"}` : null].filter(Boolean).join(" ");
  return (extra ? `${who} — ${extra}` : who).slice(0, 191);
}

export function planLeadFromDeal(p: Record<string, string | null>, normalizePhone: (raw: string) => string | null): PlannedLead {
  const name = p.dealname ?? "";
  const { type, email, fromForm } = parseDealName(name);
  const d = parseDealDescription(type, p.description);
  const hsStage = p.dealstage ?? HUBSPOT_SIGNAL_STAGE;
  const stage = HUBSPOT_STAGE_TO_LEAD[hsStage] ?? "SYGNAL";
  const createdAt = p.createdate ? new Date(p.createdate) : new Date();
  const modified = p.hs_lastmodifieddate ? new Date(p.hs_lastmodifieddate) : createdAt;
  const rawPhone = p.telefon_z_szansy || d.phone;
  const lost = stage === "PRZEGRANA";
  return {
    type,
    stage,
    title: fromForm ? leadTitle({ who: d.personName, devices: d.devices, days: d.requestedDays, fallback: email ?? name }) : name.slice(0, 191),
    email,
    phone: rawPhone ? normalizePhone(rawPhone) : null,
    personName: d.personName,
    devices: d.devices,
    requestedFrom: d.requestedFrom ? new Date(`${d.requestedFrom}T12:00:00.000Z`) : null,
    requestedDays: d.requestedDays,
    message: d.message,
    lostReason: lost ? "INNE" : null,
    lostNote: lost ? (hsStage === HUBSPOT_FREEZER_STAGE ? "Zamrażalnik w HubSpot" : p.closed_lost_reason?.trim() || "Zamknięte niepomyślnie w HubSpot") : null,
    createdAt,
    stageChangedAt: stage === "SYGNAL" ? createdAt : modified,
    fromForm,
  };
}
