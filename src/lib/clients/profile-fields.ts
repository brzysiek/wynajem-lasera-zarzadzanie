// Nowe pola karty klienta (prompt-code-karta-klienta.md, sekcja 3; model
// pól karta-klienta-model-pol.html): walidacja, kształty JSON, etykiety
// i pochodzenie pól (fieldMeta). Czysty moduł (vitest bez aliasu "@/").

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

export type PkdEntry = { code: string; name: string | null; main: boolean };
export type DeliveryNotes = { entrance: string | null; floor: string | null; parking: string | null; power: string | null; receiver: string | null };
export type ClientLinks = { www: string | null; instagram: string | null; facebook: string | null; booksy: string | null; fresha: string | null };
export type FrameAgreement = { fileId?: string | null; url: string | null; name: string | null; signedAt: string | null; note: string | null };
export type MarketingConsent = { email: boolean | null; sms: boolean | null; date: string | null; source: string | null };
export type GoogleReview = { askedAt: string | null; given: boolean | null };
export type TrainedOn = { device: string; date: string | null };

export type ClientProfilePatch = Partial<{
  shortName: string | null;
  regon: string | null;
  legalForm: string | null;
  businessStartDate: Date | null;
  pkd: PkdEntry[] | null;
  vatStatus: string | null;
  bankAccounts: string[] | null;
  deliveryAddress: string | null;
  deliveryNotes: DeliveryNotes | null;
  services: string[] | null;
  openingHours: string | null;
  links: ClientLinks | null;
  ownDevices: string | null;
  seasonality: string | null;
  agreedPrice: string | null; // Decimal jako tekst
  paymentTerms: string | null;
  paymentForm: "GOTOWKA" | "PRZELEW" | "OBA" | null;
  invoiceEmail: string | null;
  frameAgreement: FrameAgreement | null;
  marketingConsent: MarketingConsent | null;
  smsReminders: boolean | null;
  googleReview: GoogleReview | null;
  nextStepText: string | null;
  nextStepDueAt: Date | null;
}>;

export const CLIENT_PROFILE_FIELDS = [
  "shortName",
  "regon",
  "legalForm",
  "businessStartDate",
  "pkd",
  "vatStatus",
  "bankAccounts",
  "deliveryAddress",
  "deliveryNotes",
  "services",
  "openingHours",
  "links",
  "ownDevices",
  "seasonality",
  "agreedPrice",
  "paymentTerms",
  "paymentForm",
  "invoiceEmail",
  "frameAgreement",
  "marketingConsent",
  "smsReminders",
  "googleReview",
  "nextStepText",
  "nextStepDueAt",
] as const;
export type ClientProfileField = (typeof CLIENT_PROFILE_FIELDS)[number];

// Pola JSON — przy zapisie null = Prisma.DbNull.
export const CLIENT_JSON_FIELDS = ["pkd", "bankAccounts", "deliveryNotes", "services", "links", "frameAgreement", "marketingConsent", "googleReview"] as const;
export const CONTACT_JSON_FIELDS = ["roles", "trainedOn"] as const;

// Warunki handlowe ustala biuro — agent może je tylko zaproponować
// (propozycje_dodaj, rodzaj „pole”), nie zmienić sam.
export const PROPOSAL_ONLY_CLIENT_FIELDS = ["agreedPrice", "paymentTerms", "paymentForm", "transportPriceNet", "frameAgreement"] as const;

export const CLIENT_FIELD_LABEL: Record<string, string> = {
  name: "pełna nazwa",
  shortName: "nazwa robocza",
  nip: "NIP",
  regon: "REGON",
  legalForm: "forma prawna",
  businessStartDate: "data rozpoczęcia działalności",
  pkd: "PKD",
  vatStatus: "status VAT",
  bankAccounts: "rachunki bankowe",
  street: "ulica",
  zip: "kod pocztowy",
  city: "miasto",
  deliveryAddress: "adres dostawy",
  deliveryNotes: "wejście / piętro / parking / zasilanie",
  services: "usługi",
  openingHours: "godziny otwarcia",
  links: "kanały online",
  ownDevices: "własne urządzenia",
  seasonality: "sezonowość",
  agreedPrice: "cena ustalona (wynajem)",
  transportPriceNet: "transport",
  paymentTerms: "warunki płatności",
  paymentForm: "forma płatności",
  invoiceEmail: "e-mail do faktur",
  frameAgreement: "umowa ramowa",
  marketingConsent: "zgoda marketingowa",
  smsReminders: "SMS-przypomnienia",
  googleReview: "opinia Google",
  nextStepText: "następny krok",
  nextStepDueAt: "termin następnego kroku",
  clinicType: "typ gabinetu",
};

export const PERSON_ROLES = ["owner", "decides", "invoices", "reception", "cosmetologist"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];
export const PERSON_ROLE_LABEL: Record<PersonRole, string> = {
  owner: "właściciel(ka)",
  decides: "decyduje",
  invoices: "faktury",
  reception: "recepcja",
  cosmetologist: "kosmetolog",
};
// Polskie aliasy (agent, formularze).
const ROLE_ALIAS: Record<string, PersonRole> = {
  wlasciciel: "owner",
  wlascicielka: "owner",
  decyduje: "decides",
  faktury: "invoices",
  recepcja: "reception",
  kosmetolog: "cosmetologist",
  kosmetolozka: "cosmetologist",
};

// --- pomocnicze ---

function text(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l");
}

// Data RRRR-MM-DD albo DD.MM.RRRR → Date (12:00 UTC, bez przesunięć strefy).
export function parseDay(v: unknown): Date | null | "invalid" {
  const t = text(v, 32);
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return validDay(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return validDay(+m[3], +m[2], +m[1]);
  return "invalid";
}
function validDay(y: number, mo: number, d: number): Date | "invalid" {
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : "invalid";
}
const isoDay = (d: Date | "invalid" | null) => (d && d !== "invalid" ? d.toISOString().slice(0, 10) : null);

function textList(v: unknown, max = 60): string[] | null | "invalid" {
  if (v === null) return null;
  const arr = typeof v === "string" ? v.split(/[,;\n]/) : Array.isArray(v) ? v : null;
  if (!arr) return "invalid";
  const out = [...new Set(arr.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))].slice(0, max).map((x) => x.slice(0, 191));
  return out.length ? out : null;
}

function bool(v: unknown): boolean | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  if (v === true || v === "tak" || v === "true") return true;
  if (v === false || v === "nie" || v === "false") return false;
  return "invalid";
}

function obj(v: unknown): Record<string, unknown> | null | "invalid" {
  if (v === null) return null;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : "invalid";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// REGON: 9 albo 14 cyfr z sumą kontrolną.
export function validRegon(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  const check = (w: number[]) => {
    const sum = w.reduce((s, x, i) => s + x * Number(d[i]), 0);
    return (sum % 11) % 10 === Number(d[w.length]);
  };
  if (d.length === 9) return check([8, 9, 2, 3, 4, 5, 6, 7]);
  if (d.length === 14) return check([2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8]);
  return false;
}

// PKD: „96.02.Z zabiegi kosmetyczne” albo { code, name, main }.
export function parsePkd(v: unknown): PkdEntry[] | null | "invalid" {
  if (v === null) return null;
  const arr = typeof v === "string" ? v.split(/[;\n]|,(?=\s*\d{2}\.\d{2})/) : Array.isArray(v) ? v : null;
  if (!arr) return "invalid";
  const out: PkdEntry[] = [];
  for (const [i, item] of arr.entries()) {
    const raw = typeof item === "string" ? { code: item } : item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!raw) return "invalid";
    const s = text(raw.code ?? raw.kod, 200);
    if (!s) continue;
    const m = s.match(/^(\d{2})\.?(\d{2})\.?([A-Za-z])\s*(.*)$/);
    if (!m) return "invalid";
    out.push({ code: `${m[1]}.${m[2]}.${m[3].toUpperCase()}`, name: text(raw.name ?? raw.nazwa, 191) ?? (m[4] ? m[4].trim() : null), main: raw.main === true || raw.glowny === true || (i === 0 && raw.main === undefined && raw.glowny === undefined) });
  }
  return out.length ? out : null;
}

// --- klient ---

export function parseClientProfilePatch(body: Record<string, unknown>): Result<ClientProfilePatch> {
  const out: ClientProfilePatch = {};
  const has = (k: string) => k in body;

  for (const k of ["shortName", "legalForm", "vatStatus", "deliveryAddress", "openingHours", "ownDevices", "seasonality", "paymentTerms", "nextStepText"] as const) {
    if (has(k)) out[k] = text(body[k], k === "legalForm" ? 64 : k === "vatStatus" ? 32 : k === "shortName" ? 191 : 2000);
  }
  if (has("regon")) {
    const r = text(body.regon, 32);
    if (r && !validRegon(r)) return { ok: false, message: "REGON musi mieć 9 albo 14 cyfr (z poprawną sumą kontrolną)." };
    out.regon = r ? r.replace(/\D/g, "") : null;
  }
  for (const k of ["businessStartDate", "nextStepDueAt"] as const) {
    if (!has(k)) continue;
    const d = parseDay(body[k]);
    if (d === "invalid") return { ok: false, message: `${CLIENT_FIELD_LABEL[k]}: data RRRR-MM-DD albo DD.MM.RRRR.` };
    out[k] = d;
  }
  if (has("pkd")) {
    const p = parsePkd(body.pkd);
    if (p === "invalid") return { ok: false, message: "PKD: kody w formacie 96.02.Z (z opcjonalną nazwą)." };
    out.pkd = p;
  }
  for (const k of ["bankAccounts", "services"] as const) {
    if (!has(k)) continue;
    const l = textList(body[k]);
    if (l === "invalid") return { ok: false, message: `${CLIENT_FIELD_LABEL[k]}: lista tekstów.` };
    out[k] = k === "bankAccounts" && l ? l.map((x) => x.replace(/\s/g, "")) : l;
  }
  if (has("deliveryNotes")) {
    const o = obj(body.deliveryNotes);
    if (o === "invalid") return { ok: false, message: "deliveryNotes: obiekt { entrance, floor, parking, power, receiver }." };
    const n: DeliveryNotes | null = o ? { entrance: text(o.entrance ?? o.wejscie), floor: text(o.floor ?? o.pietro), parking: text(o.parking), power: text(o.power ?? o.zasilanie), receiver: text(o.receiver ?? o.odbiera) } : null;
    out.deliveryNotes = n && Object.values(n).some(Boolean) ? n : null;
  }
  if (has("links")) {
    const o = obj(body.links);
    if (o === "invalid") return { ok: false, message: "links: obiekt { www, instagram, facebook, booksy, fresha }." };
    const n: ClientLinks | null = o ? { www: text(o.www, 300), instagram: text(o.instagram, 300), facebook: text(o.facebook, 300), booksy: text(o.booksy, 300), fresha: text(o.fresha, 300) } : null;
    out.links = n && Object.values(n).some(Boolean) ? n : null;
  }
  if (has("agreedPrice")) {
    const raw = text(body.agreedPrice === null ? null : String(body.agreedPrice), 32);
    if (raw) {
      const n = Number(raw.replace(/\s/g, "").replace(",", ".").replace(/zł$/i, ""));
      if (!Number.isFinite(n) || n < 0) return { ok: false, message: "Cena ustalona: kwota netto, np. 1180." };
      out.agreedPrice = n.toFixed(2);
    } else out.agreedPrice = null;
  }
  if (has("paymentForm")) {
    const raw = text(body.paymentForm, 32);
    const k = raw ? fold(raw).replace(/[^a-z]/g, "") : null;
    const form = k === null ? null : k === "gotowka" ? "GOTOWKA" : k === "przelew" ? "PRZELEW" : k === "oba" || k === "gotowkaiprzelew" ? "OBA" : "invalid";
    if (form === "invalid") return { ok: false, message: "Forma płatności: gotówka, przelew albo oba." };
    out.paymentForm = form;
  }
  if (has("invoiceEmail")) {
    const e = text(body.invoiceEmail, 191)?.toLowerCase() ?? null;
    if (e && !EMAIL_RE.test(e)) return { ok: false, message: "Nieprawidłowy e-mail do faktur." };
    out.invoiceEmail = e;
  }
  if (has("frameAgreement")) {
    const o = obj(body.frameAgreement);
    if (o === "invalid") return { ok: false, message: "frameAgreement: obiekt { url, name, signedAt, note }." };
    const url = o ? text(o.url, 500) : null;
    if (url && !/^https:\/\//.test(url)) return { ok: false, message: "Umowa ramowa: link https:// (np. z Dysku Google)." };
    const signed = o ? parseDay(o.signedAt) : null;
    if (signed === "invalid") return { ok: false, message: "Umowa ramowa: data podpisania RRRR-MM-DD." };
    const n: FrameAgreement | null = o ? { fileId: text(o.fileId, 64), url, name: text(o.name, 191), signedAt: isoDay(signed), note: text(o.note, 500) } : null;
    out.frameAgreement = n && Object.values(n).some(Boolean) ? n : null;
  }
  if (has("marketingConsent")) {
    const o = obj(body.marketingConsent);
    if (o === "invalid") return { ok: false, message: "marketingConsent: obiekt { email, sms, date, source }." };
    if (o) {
      const email = bool(o.email);
      const sms = bool(o.sms);
      const date = parseDay(o.date);
      if (email === "invalid" || sms === "invalid" || date === "invalid") return { ok: false, message: "Zgoda marketingowa: email/sms tak|nie, data RRRR-MM-DD." };
      out.marketingConsent = { email, sms, date: isoDay(date), source: text(o.source, 191) };
    } else out.marketingConsent = null;
  }
  if (has("smsReminders")) {
    const b = bool(body.smsReminders);
    if (b === "invalid") return { ok: false, message: "SMS-przypomnienia: tak albo nie." };
    out.smsReminders = b;
  }
  if (has("googleReview")) {
    const o = obj(body.googleReview);
    if (o === "invalid") return { ok: false, message: "googleReview: obiekt { askedAt, given }." };
    if (o) {
      const asked = parseDay(o.askedAt);
      const given = bool(o.given);
      if (asked === "invalid" || given === "invalid") return { ok: false, message: "Opinia Google: askedAt RRRR-MM-DD, given tak|nie." };
      out.googleReview = { askedAt: isoDay(asked), given };
    } else out.googleReview = null;
  }
  return { ok: true, data: out };
}

// --- osoba ---

export type ContactProfilePatch = Partial<{
  roles: PersonRole[] | null;
  preferredChannel: string | null;
  salutation: string | null;
  trainedOn: TrainedOn[] | null;
}>;

export const CONTACT_PROFILE_FIELDS = ["roles", "preferredChannel", "salutation", "trainedOn"] as const;

export function parseContactProfilePatch(body: Record<string, unknown>): Result<ContactProfilePatch> {
  const out: ContactProfilePatch = {};
  if ("roles" in body) {
    const l = textList(body.roles, 10);
    if (l === "invalid") return { ok: false, message: "roles: lista ról (owner, decides, invoices, reception, cosmetologist)." };
    const roles: PersonRole[] = [];
    for (const r of l ?? []) {
      const k = fold(r).replace(/[^a-z]/g, "");
      const role = (PERSON_ROLES as readonly string[]).includes(k) ? (k as PersonRole) : ROLE_ALIAS[k];
      if (!role) return { ok: false, message: `Nieznana rola „${r}” — dozwolone: owner, decides, invoices, reception, cosmetologist.` };
      if (!roles.includes(role)) roles.push(role);
    }
    out.roles = roles.length ? roles : null;
  }
  if ("preferredChannel" in body) out.preferredChannel = text(body.preferredChannel, 64);
  if ("salutation" in body) out.salutation = text(body.salutation, 191);
  if ("trainedOn" in body) {
    const v = body.trainedOn;
    if (v === null) out.trainedOn = null;
    else if (!Array.isArray(v)) return { ok: false, message: "trainedOn: lista { device, date }." };
    else {
      const list: TrainedOn[] = [];
      for (const item of v) {
        const o = typeof item === "string" ? { device: item } : item && typeof item === "object" ? (item as Record<string, unknown>) : null;
        const device = o ? text(o.device ?? o.urzadzenie, 191) : null;
        if (!device) return { ok: false, message: "trainedOn: każde szkolenie wymaga urządzenia." };
        const date = parseDay(o!.date ?? o!.data);
        if (date === "invalid") return { ok: false, message: "trainedOn: data RRRR-MM-DD." };
        list.push({ device, date: isoDay(date) });
      }
      out.trainedOn = list.length ? list : null;
    }
  }
  return { ok: true, data: out };
}

// --- pochodzenie pól ---

export type FieldMetaEntry = { source: string; sourceRef: string | null; verifiedAt: string; verifiedBy: string | null; lockedManual: boolean };
export type FieldMeta = Record<string, FieldMetaEntry>;

export function readFieldMeta(v: unknown): FieldMeta {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as FieldMeta) : {};
}

// Po zmianie pól: źródło i data weryfikacji. Zmiana z panelu albo przez
// agenta blokuje pole dla synchronizacji (lockedManual); uzupełnianie po
// NIP (bialalista / ceidg) nie blokuje.
export function stampFieldMeta(
  meta: FieldMeta,
  fields: string[],
  stamp: { source: string; sourceRef?: string | null; by: string | null; at: Date; lock: boolean },
): FieldMeta {
  const out = { ...meta };
  for (const f of fields) {
    out[f] = { source: stamp.source, sourceRef: stamp.sourceRef ?? null, verifiedAt: stamp.at.toISOString(), verifiedBy: stamp.by, lockedManual: stamp.lock || (meta[f]?.lockedManual ?? false) };
  }
  return out;
}

export const isLocked = (meta: FieldMeta, field: string) => meta[field]?.lockedManual === true;

// Przy tworzeniu rekordu null w polu JSON = brak pola (Prisma nie przyjmuje
// gołego null dla Json?).
type JsonKey = (typeof CLIENT_JSON_FIELDS)[number] | (typeof CONTACT_JSON_FIELDS)[number];
export type DropNullJson<T> = { [P in keyof T]: P extends JsonKey ? Exclude<T[P], null> : T[P] };
export function dropNullJson<T extends Record<string, unknown>>(data: T, keys: readonly string[] = CONTACT_JSON_FIELDS): DropNullJson<T> {
  const out: Record<string, unknown> = { ...data };
  for (const k of keys) if (out[k] === null) delete out[k];
  return out as DropNullJson<T>;
}
