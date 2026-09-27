// Kolejka propozycji zmian — czyste reguły (vitest, bez @/): rodzaje,
// dozwolone pola, walidacja zgłoszenia od agenta.
import { AGENT_PROPOSAL_CLIENT_FIELDS } from "../permissions";
import { parseProvenance, type Provenance } from "../changelog/provenance";
import { parseArchiveInput, type ArchiveInput } from "./archive-rules";
import { parseSplitInput } from "../clients/split-rules";
import { parseExclusionList } from "./exclusion-rules";

export const PROPOSAL_KIND_LABEL = {
  FIELD: "pole klienta",
  CONTACT_FIELD: "pole osoby",
  ARCHIVE: "archiwizacja",
  MERGE: "scalenie duplikatu",
  SPLIT: "wydzielenie do nowego klienta",
  PAYMENT_MATCH: "dopasowanie przelewu do faktury",
  EXCLUSION: "lista wykluczeń domen",
} as const;
export type ProposalKind = keyof typeof PROPOSAL_KIND_LABEL;

export const PROPOSAL_STATUS_LABEL = { PENDING: "oczekuje", ACCEPTED: "zaakceptowana", REJECTED: "odrzucona" } as const;
export type ChangeProposalStatus = keyof typeof PROPOSAL_STATUS_LABEL;

export const CONTACT_PROPOSAL_FIELDS = ["firstName", "lastName", "phone", "phone2", "phone2Label", "email", "role", "roles", "preferredChannel", "salutation", "trainedOn"] as const;

const KIND_ALIASES: Record<string, ProposalKind> = {
  pole: "FIELD",
  field: "FIELD",
  osoba: "CONTACT_FIELD",
  contact_field: "CONTACT_FIELD",
  archiwizacja: "ARCHIVE",
  archive: "ARCHIVE",
  scalenie: "MERGE",
  merge: "MERGE",
  wydzielenie: "SPLIT",
  split: "SPLIT",
  dopasowanie_platnosci: "PAYMENT_MATCH",
  payment_match: "PAYMENT_MATCH",
  wykluczenie: "EXCLUSION",
  exclusion: "EXCLUSION",
};

export type ParsedProposal = {
  kind: ProposalKind;
  clientId: string | null;
  contactId: string | null;
  leadId: string | null;
  field: string | null;
  proposed: unknown; // FIELD/CONTACT_FIELD: wartość; ARCHIVE: ArchiveInput; MERGE: { duplicateId }; PAYMENT_MATCH: { transferId, fakturowniaInvoiceId }
  provenance: Provenance;
  changeClass: string | null;
};

const str = (v: unknown, max = 191) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// Klasa zmiany: krótki klucz, np. „miasto_slownik” (małe litery, cyfry, _).
export function normalizeClass(v: unknown): string | null {
  const s = str(v, 64);
  if (!s) return null;
  const k = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return k || null;
}

export function parseProposalItem(item: Record<string, unknown>): { ok: true; value: ParsedProposal } | { ok: false; message: string } {
  const rawKind = str(item.rodzaj ?? item.kind, 32)?.toLowerCase();
  const kind = rawKind ? KIND_ALIASES[rawKind] : undefined;
  if (!kind) return { ok: false, message: "rodzaj: pole, osoba, archiwizacja, scalenie, wydzielenie, dopasowanie_platnosci albo wykluczenie." };
  const provenance = parseProvenance(item, { required: true });
  if (!provenance.ok) return provenance;
  if (!provenance.value.batch) return { ok: false, message: "Podaj paczkę (paczka)." };
  const clientId = str(item.klient_id ?? item.clientId, 64);
  const changeClass = normalizeClass(item.klasa ?? item.changeClass);
  const base = { clientId, contactId: null, leadId: null, field: null, provenance: provenance.value, changeClass };

  if (kind === "FIELD" || kind === "CONTACT_FIELD") {
    if (!clientId) return { ok: false, message: "Podaj klient_id." };
    const field = str(item.pole ?? item.field, 64);
    const allowed: readonly string[] = kind === "FIELD" ? AGENT_PROPOSAL_CLIENT_FIELDS : CONTACT_PROPOSAL_FIELDS;
    if (!field || !allowed.includes(field)) return { ok: false, message: `pole: ${allowed.join(", ")}.` };
    if (!("proponowane" in item) && !("proposed" in item)) return { ok: false, message: "Podaj proponowane (może być null)." };
    const contactId = kind === "CONTACT_FIELD" ? str(item.osoba_id ?? item.contactId, 64) : null;
    if (kind === "CONTACT_FIELD" && !contactId) return { ok: false, message: "Podaj osoba_id." };
    return { ok: true, value: { ...base, kind, contactId, field, proposed: item.proponowane ?? item.proposed ?? null } };
  }
  if (kind === "ARCHIVE") {
    const leadId = str(item.sygnal_id ?? item.leadId, 64);
    if (!clientId && !leadId) return { ok: false, message: "Podaj klient_id albo sygnal_id." };
    if (clientId && leadId) return { ok: false, message: "Archiwizacja dotyczy klienta albo sygnału — nie obu naraz." };
    const archive = parseArchiveInput(item);
    if (!archive.ok) return archive;
    return { ok: true, value: { ...base, kind, leadId, proposed: archive.value satisfies ArchiveInput } };
  }
  if (kind === "SPLIT") {
    if (!clientId) return { ok: false, message: "Podaj klient_id (klient-zlepek)." };
    const split = parseSplitInput(item);
    if (!split.ok) return split;
    return { ok: true, value: { ...base, kind, proposed: split.value } };
  }
  if (kind === "EXCLUSION") {
    const raw = item.wartosci ?? item.values;
    const text = Array.isArray(raw) ? raw.filter((x) => typeof x === "string").join("\n") : typeof raw === "string" ? raw : "";
    const { values, errors } = parseExclusionList(text);
    if (!values.length) return { ok: false, message: errors[0] ?? "Podaj wartosci — domeny albo adresy e-mail." };
    if (values.length > 500) return { ok: false, message: "Maks. 500 domen w jednej propozycji." };
    const t = str(item.typ ?? item.kind_list, 16)?.toLowerCase();
    const listKind = t === "ukrywaj" || t === "hide" ? "HIDE" : "EXCLUDE";
    return { ok: true, value: { ...base, kind, proposed: { values, kind: listKind, note: str(item.dopisek ?? item.note, 500) } } };
  }
  if (kind === "PAYMENT_MATCH") {
    const transferId = str(item.przelew_id ?? item.transferId, 64);
    const invoiceRaw = item.faktura_id ?? item.fakturowniaInvoiceId;
    const fakturowniaInvoiceId = typeof invoiceRaw === "number" ? invoiceRaw : typeof invoiceRaw === "string" && /^\d+$/.test(invoiceRaw.trim()) ? Number(invoiceRaw) : NaN;
    if (!transferId) return { ok: false, message: "Podaj przelew_id (z narzędzia platnosci)." };
    if (!Number.isInteger(fakturowniaInvoiceId) || fakturowniaInvoiceId <= 0) return { ok: false, message: "Podaj faktura_id (liczbowe ID faktury z narzędzia platnosci)." };
    return { ok: true, value: { ...base, kind, proposed: { transferId, fakturowniaInvoiceId } } };
  }
  // MERGE
  const duplicateId = str(item.duplikat_id ?? item.duplicateId, 64);
  if (!clientId || !duplicateId) return { ok: false, message: "Podaj klient_id (zostaje) i duplikat_id." };
  if (clientId === duplicateId) return { ok: false, message: "Duplikat musi być innym klientem." };
  return { ok: true, value: { ...base, kind, proposed: { duplicateId } } };
}
