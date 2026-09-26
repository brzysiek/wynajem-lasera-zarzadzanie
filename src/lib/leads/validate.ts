// Walidacja zmian sygnału z panelu (PATCH /api/leads/[id], POST /api/leads).
// Czyste funkcje, normalizacja telefonu wstrzykiwana (vitest bez "@/").
import { STAGE_KEYS, TYPE_KEYS, LOST_REASON_KEYS, type LostReasonKey } from "./labels";
import type { LeadStageKey, LeadTypeKey } from "./parse-deal";
import { DEVICE_INTEREST_KEYS, type DeviceInterestKey } from "../clients/labels";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

// „RRRR-MM-DD” → 9:00 czasu lokalnego (serwer = Europe/Warsaw), null = czyść.
export function parseDay(v: unknown): Date | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const text = (v: unknown, max = 5000) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

export type LeadPatch = Partial<{
  stage: LeadStageKey;
  lostReason: LostReasonKey;
  lostNote: string | null;
  returnAt: Date | null;
  ownerId: string | null;
  nextActionAt: Date | null;
  deviceInterest: DeviceInterestKey[];
  requestedFrom: Date | null;
  requestedDays: number | null;
  location: string | null;
  message: string | null;
  title: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  rentalId: string | null;
  clientId: string | null;
}>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Tylko pola obecne w body — PATCH zmienia wyłącznie to, co przyszło.
export function parseLeadPatch(body: Record<string, unknown>, deps: { normalizePhone: (raw: string) => string | null }): Result<LeadPatch> {
  const out: LeadPatch = {};
  if ("stage" in body) {
    if (!STAGE_KEYS.includes(body.stage as LeadStageKey)) return { ok: false, message: "Nieznany etap." };
    out.stage = body.stage as LeadStageKey;
    if (out.stage === "PRZEGRANA") {
      if (!LOST_REASON_KEYS.includes(body.lostReason as LostReasonKey)) return { ok: false, message: "Wybierz powód przegranej." };
      out.lostReason = body.lostReason as LostReasonKey;
      out.lostNote = text(body.lostNote);
      if ("returnAt" in body) {
        const r = parseDay(body.returnAt);
        if (r === undefined) return { ok: false, message: "Nieprawidłowa data powrotu do kontaktu." };
        out.returnAt = r;
      }
    }
  }
  if ("ownerId" in body) out.ownerId = typeof body.ownerId === "string" && body.ownerId ? body.ownerId : null;
  for (const key of ["nextActionAt", "requestedFrom"] as const) {
    if (key in body) {
      const d = parseDay(body[key]);
      if (d === undefined) return { ok: false, message: "Nieprawidłowa data." };
      out[key] = d;
    }
  }
  if ("requestedDays" in body) {
    const n = body.requestedDays === null || body.requestedDays === "" ? null : Number(body.requestedDays);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 60)) return { ok: false, message: "Liczba dni musi być od 1 do 60." };
    out.requestedDays = n;
  }
  if ("deviceInterest" in body) {
    const v = body.deviceInterest;
    if (!Array.isArray(v) || v.some((x) => !DEVICE_INTEREST_KEYS.includes(x as DeviceInterestKey))) {
      return { ok: false, message: "Nieznane urządzenie." };
    }
    out.deviceInterest = v as DeviceInterestKey[];
  }
  if ("title" in body) {
    const t = text(body.title, 191);
    if (!t) return { ok: false, message: "Nazwa sygnału nie może być pusta." };
    out.title = t;
  }
  for (const key of ["location", "message", "contactName"] as const) if (key in body) out[key] = text(body[key], key === "message" ? 5000 : 191);
  if ("contactPhone" in body) {
    const raw = text(body.contactPhone);
    if (raw) {
      const p = deps.normalizePhone(raw);
      if (!p) return { ok: false, message: "Nieprawidłowy numer telefonu." };
      out.contactPhone = p;
    } else out.contactPhone = null;
  }
  if ("contactEmail" in body) {
    const e = text(body.contactEmail)?.toLowerCase() ?? null;
    if (e && !EMAIL_RE.test(e)) return { ok: false, message: "Nieprawidłowy adres e-mail." };
    out.contactEmail = e;
  }
  if ("rentalId" in body) out.rentalId = typeof body.rentalId === "string" && body.rentalId ? body.rentalId : null;
  if ("clientId" in body) out.clientId = typeof body.clientId === "string" && body.clientId ? body.clientId : null;
  return { ok: true, data: out };
}

export type NewLeadInput = {
  type: LeadTypeKey;
  clientId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  deviceInterest: DeviceInterestKey[];
  requestedFrom: Date | null;
  requestedDays: number | null;
  message: string | null;
  location: string | null;
};

export function parseNewLead(body: Record<string, unknown>, deps: { normalizePhone: (raw: string) => string | null }): Result<NewLeadInput> {
  const type = (body.type ?? "TELEFON") as LeadTypeKey;
  if (!TYPE_KEYS.includes(type)) return { ok: false, message: "Nieznany typ sygnału." };
  const patch = parseLeadPatch(
    Object.fromEntries(
      Object.entries(body).filter(([k]) =>
        ["contactName", "contactPhone", "contactEmail", "deviceInterest", "requestedFrom", "requestedDays", "message", "location"].includes(k),
      ),
    ),
    deps,
  );
  if (!patch.ok) return patch;
  const clientId = typeof body.clientId === "string" && body.clientId ? body.clientId : null;
  const p = patch.data;
  if (!clientId && !p.contactName && !p.contactPhone && !p.contactEmail) {
    return { ok: false, message: "Wybierz klienta albo podaj imię, telefon lub e-mail." };
  }
  return {
    ok: true,
    data: {
      type,
      clientId,
      contactName: p.contactName ?? null,
      contactPhone: p.contactPhone ?? null,
      contactEmail: p.contactEmail ?? null,
      deviceInterest: p.deviceInterest ?? [],
      requestedFrom: p.requestedFrom ?? null,
      requestedDays: p.requestedDays ?? null,
      message: p.message ?? null,
      location: p.location ?? null,
    },
  };
}
