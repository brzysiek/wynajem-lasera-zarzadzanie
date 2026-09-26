// POST /api/agent/dziennik — ręczny wpis w dzienniku dla zmian, które nie
// przechodzą przez standardowe endpointy (np. zmiana w HubSpocie, scalenie
// zrobione ręcznie). Walidacja: obiekt, operacja, wartość przed (wymagana),
// źródło i pewność. Czysty moduł (vitest, bez @/).
import { parseProvenance, type Provenance } from "../changelog/provenance";

const ENTITY_ALIASES: Record<string, string> = {
  klient: "CLIENT",
  kontakt: "CONTACT",
  osoba: "CONTACT",
  kontakt_z_zapytania: "CLIENT",
  sygnal: "LEAD",
  "sygnał": "LEAD",
  dopasowanie: "HISTORY",
  faktura: "INVOICE",
};
const ENTITIES = ["CLIENT", "CONTACT", "LEAD", "HISTORY", "INVOICE"];

const OPERATION_ALIASES: Record<string, string> = {
  zmiana_pola: "FIELD_CHANGE",
  scalenie: "MERGE",
  zmiana_statusu: "STATUS_CHANGE",
  przeniesienie_do_zapytan: "MOVE_TO_INQUIRIES",
  nie_kontaktowac: "DO_NOT_CONTACT",
  potwierdzenie_dopasowania: "MATCH_ASSIGN",
  odrzucenie_dopasowania: "MATCH_IGNORE",
};
export const MANUAL_OPERATIONS = ["FIELD_CHANGE", "MERGE", "STATUS_CHANGE", "MOVE_TO_INQUIRIES", "DO_NOT_CONTACT", "MATCH_ASSIGN", "MATCH_IGNORE"];

export type ManualEntry = {
  clientId: string | null;
  entity: string;
  entityId: string;
  operation: string;
  field: string | null;
  before: string;
  after: string | null;
  provenance: Provenance;
};

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function parseManualEntry(body: Record<string, unknown>): { ok: true; value: ManualEntry } | { ok: false; message: string } {
  const rawEntity = str(body.obiekt ?? body.entity, 32);
  const entity = rawEntity ? (ENTITY_ALIASES[rawEntity.toLowerCase()] ?? rawEntity.toUpperCase()) : null;
  if (!entity || !ENTITIES.includes(entity)) return { ok: false, message: "obiekt: klient, kontakt, sygnal, dopasowanie albo faktura." };
  const entityId = str(body.obiekt_id ?? body.entityId, 191);
  if (!entityId) return { ok: false, message: "Podaj obiekt_id (identyfikator rekordu)." };
  const rawOp = str(body.operacja ?? body.operation, 32);
  const operation = rawOp ? (OPERATION_ALIASES[rawOp.toLowerCase()] ?? rawOp.toUpperCase()) : null;
  if (!operation || !MANUAL_OPERATIONS.includes(operation)) return { ok: false, message: `operacja: ${Object.keys(OPERATION_ALIASES).join(", ")}.` };
  if (!("przed" in body) && !("before" in body)) return { ok: false, message: "Podaj wartość przed (przed) — może być null." };
  const provenance = parseProvenance(body, { required: true });
  if (!provenance.ok) return provenance;
  const before = body.przed ?? body.before;
  const after = "po" in body ? body.po : "after" in body ? body.after : undefined;
  return {
    ok: true,
    value: {
      clientId: str(body.klient_id ?? body.clientId, 64),
      entity,
      entityId,
      operation,
      field: str(body.pole ?? body.field, 64),
      before: JSON.stringify(before ?? null),
      after: after === undefined ? null : JSON.stringify(after),
      provenance: provenance.value,
    },
  };
}
