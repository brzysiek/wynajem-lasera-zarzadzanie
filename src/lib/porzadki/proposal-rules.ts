// Kolejka propozycji zmian — czyste reguły (vitest, bez @/): rodzaje,
// dozwolone pola, walidacja zgłoszenia od agenta.
import { AGENT_CLIENT_FIELDS } from "../permissions";
import { parseProvenance, type Provenance } from "../changelog/provenance";
import { parseArchiveInput, type ArchiveInput } from "./archive-rules";

export const PROPOSAL_KIND_LABEL = {
  FIELD: "pole klienta",
  CONTACT_FIELD: "pole osoby",
  ARCHIVE: "archiwizacja",
  MERGE: "scalenie duplikatu",
} as const;
export type ProposalKind = keyof typeof PROPOSAL_KIND_LABEL;

export const PROPOSAL_STATUS_LABEL = { PENDING: "oczekuje", ACCEPTED: "zaakceptowana", REJECTED: "odrzucona" } as const;
export type ChangeProposalStatus = keyof typeof PROPOSAL_STATUS_LABEL;

export const CONTACT_PROPOSAL_FIELDS = ["firstName", "lastName", "phone", "phone2", "phone2Label", "email", "role"] as const;

const KIND_ALIASES: Record<string, ProposalKind> = {
  pole: "FIELD",
  field: "FIELD",
  osoba: "CONTACT_FIELD",
  contact_field: "CONTACT_FIELD",
  archiwizacja: "ARCHIVE",
  archive: "ARCHIVE",
  scalenie: "MERGE",
  merge: "MERGE",
};

export type ParsedProposal = {
  kind: ProposalKind;
  clientId: string | null;
  contactId: string | null;
  leadId: string | null;
  field: string | null;
  proposed: unknown; // FIELD/CONTACT_FIELD: wartość; ARCHIVE: ArchiveInput; MERGE: { duplicateId }
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
  if (!kind) return { ok: false, message: "rodzaj: pole, osoba, archiwizacja albo scalenie." };
  const provenance = parseProvenance(item, { required: true });
  if (!provenance.ok) return provenance;
  if (!provenance.value.batch) return { ok: false, message: "Podaj paczkę (paczka)." };
  const clientId = str(item.klient_id ?? item.clientId, 64);
  const changeClass = normalizeClass(item.klasa ?? item.changeClass);
  const base = { clientId, contactId: null, leadId: null, field: null, provenance: provenance.value, changeClass };

  if (kind === "FIELD" || kind === "CONTACT_FIELD") {
    if (!clientId) return { ok: false, message: "Podaj klient_id." };
    const field = str(item.pole ?? item.field, 64);
    const allowed: readonly string[] = kind === "FIELD" ? AGENT_CLIENT_FIELDS : CONTACT_PROPOSAL_FIELDS;
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
  // MERGE
  const duplicateId = str(item.duplikat_id ?? item.duplicateId, 64);
  if (!clientId || !duplicateId) return { ok: false, message: "Podaj klient_id (zostaje) i duplikat_id." };
  if (clientId === duplicateId) return { ok: false, message: "Duplikat musi być innym klientem." };
  return { ok: true, value: { ...base, kind, proposed: { duplicateId } } };
}
