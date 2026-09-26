// Walidacja i normalizacja danych z formularzy modułu Klienci — czyste
// funkcje (vitest). Normalizacja telefonu wstrzykiwana (normalizePolishPhone
// z src/lib/reminders.ts — ta sama co SMS).
import { normalizeNip, parseDistanceKm, parseMoney } from "./hubspot-import";
import { CLINIC_TYPE_LABEL, DEVICE_INTEREST_KEYS, SOURCE_LABEL, type DeviceInterestKey } from "./labels";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };
type Deps = { normalizePhone: (raw: string) => string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export type ClientPatch = Partial<{
  name: string;
  nip: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  transportPriceNet: string | null;
  distanceKm: string | null;
  clinicType: keyof typeof CLINIC_TYPE_LABEL | null;
  source: keyof typeof SOURCE_LABEL | null;
  deviceInterests: DeviceInterestKey[];
  statusOverride: "NIE_KONTAKTOWAC" | null;
  notes: string | null;
}>;

// Tylko pola obecne w body — PATCH zmienia wyłącznie to, co przyszło.
export function parseClientPatch(body: Record<string, unknown>): Result<ClientPatch> {
  const out: ClientPatch = {};
  if ("name" in body) {
    const name = text(body.name);
    if (!name) return { ok: false, message: "Nazwa klienta nie może być pusta." };
    out.name = name;
  }
  if ("nip" in body) {
    const { nip, invalid } = normalizeNip(text(body.nip));
    if (invalid) return { ok: false, message: "NIP musi mieć 10 cyfr." };
    out.nip = nip;
  }
  for (const key of ["street", "zip", "city", "country"] as const) {
    if (key in body) out[key] = text(body[key]);
  }
  if ("transportPriceNet" in body) {
    const { value, invalid } = parseMoney(text(body.transportPriceNet));
    if (invalid) return { ok: false, message: "Cena transportu musi być liczbą, np. 150." };
    out.transportPriceNet = value;
  }
  if ("distanceKm" in body) {
    const raw = text(body.distanceKm);
    const km = parseDistanceKm(raw);
    if (raw && !km) return { ok: false, message: "Odległość musi być liczbą kilometrów." };
    out.distanceKm = km;
  }
  if ("clinicType" in body) {
    const v = body.clinicType;
    if (v !== null && !(typeof v === "string" && v in CLINIC_TYPE_LABEL)) return { ok: false, message: "Nieznany rodzaj gabinetu." };
    out.clinicType = v as ClientPatch["clinicType"];
  }
  if ("source" in body) {
    const v = body.source;
    if (v !== null && !(typeof v === "string" && v in SOURCE_LABEL)) return { ok: false, message: "Nieznane źródło." };
    out.source = v as ClientPatch["source"];
  }
  if ("deviceInterests" in body) {
    const v = body.deviceInterests;
    if (!Array.isArray(v) || v.some((x) => !DEVICE_INTEREST_KEYS.includes(x as DeviceInterestKey))) {
      return { ok: false, message: "Nieznane urządzenie w zainteresowaniach." };
    }
    out.deviceInterests = [...new Set(v as DeviceInterestKey[])];
  }
  if ("statusOverride" in body) {
    const v = body.statusOverride;
    if (v !== null && v !== "NIE_KONTAKTOWAC") return { ok: false, message: "Nieprawidłowa blokada." };
    out.statusOverride = v;
  }
  if ("notes" in body) out.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  return { ok: true, data: out };
}

export type ContactInput = Partial<{
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phone2: string | null;
  phone2Label: string | null;
  email: string | null;
  role: string | null;
  isPrimary: boolean;
}>;

export function parseContactInput(body: Record<string, unknown>, deps: Deps, opts: { requireName?: boolean } = {}): Result<ContactInput> {
  const out: ContactInput = {};
  for (const key of ["firstName", "lastName", "role", "phone2Label"] as const) if (key in body) out[key] = text(body[key]);
  for (const key of ["phone", "phone2"] as const) {
    if (!(key in body)) continue;
    const raw = text(body[key]);
    if (raw) {
      const phone = deps.normalizePhone(raw);
      if (!phone) return { ok: false, message: key === "phone" ? "Nieprawidłowy numer telefonu." : "Nieprawidłowy drugi numer telefonu." };
      out[key] = phone;
    } else out[key] = null;
  }
  if ("phone2" in out && !out.phone2) out.phone2Label = null;
  if ("email" in body) {
    const email = text(body.email)?.toLowerCase() ?? null;
    if (email && !EMAIL_RE.test(email)) return { ok: false, message: "Nieprawidłowy adres e-mail." };
    out.email = email;
  }
  if ("isPrimary" in body) out.isPrimary = body.isPrimary === true;
  if (opts.requireName && !out.firstName && !out.lastName && !out.email && !out.phone) {
    return { ok: false, message: "Podaj przynajmniej imię, telefon albo e-mail osoby." };
  }
  return { ok: true, data: out };
}
