// „Cofnij” w dzienniku zmian — które wpisy da się cofnąć i czy bieżąca
// wartość nadal równa się „wartości po” (inaczej konflikt). Czysty moduł.

const CLIENT_FIELDS = [
  "name",
  "nip",
  "street",
  "zip",
  "city",
  "country",
  "transportPriceNet",
  "distanceKm",
  "clinicType",
  "source",
  "deviceInterests",
  "statusOverride",
  "notes",
];
// isPrimary pomijamy — zdjęcie „głównej” wymaga wskazania innej osoby.
const CONTACT_FIELDS = ["firstName", "lastName", "phone", "phone2", "phone2Label", "email", "role"];

export type UndoableEntry = { entity: string; operation: string; field: string | null; after: string | null; undoneById: string | null; undoOfId: string | null };

export function undoKind(e: UndoableEntry): "client-field" | "contact-field" | "note-body" | "qualification" | "invoice-rental" | null {
  if (e.operation === "FIELD_CHANGE") {
    if (e.entity === "CLIENT" && e.field && CLIENT_FIELDS.includes(e.field)) return "client-field";
    if (e.entity === "CONTACT" && e.field && CONTACT_FIELDS.includes(e.field)) return "contact-field";
    if (e.entity === "NOTE" && e.field === "body") return "note-body";
    if (e.entity === "INVOICE" && e.field === "rentalId") return "invoice-rental";
  }
  if (e.entity === "CLIENT" && (e.operation === "QUALIFY" || e.operation === "UNQUALIFY")) return "qualification";
  return null;
}

export function isUndoable(e: UndoableEntry): boolean {
  return !e.undoneById && !e.undoOfId && e.operation !== "UNDO" && undoKind(e) !== null;
}

function parse(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function numeric(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}

// Porównanie dwóch wartości z dziennika: kwoty „150” i „150.00” są równe.
export function sameLogValue(a: string | null, b: string | null): boolean {
  const x = parse(a);
  const y = parse(b);
  const nx = numeric(x);
  const ny = numeric(y);
  if (nx !== null && ny !== null) return nx === ny;
  return JSON.stringify(x) === JSON.stringify(y);
}

export type UndoCheck = { ok: true } | { ok: false; reason: "not-undoable" | "already-undone" | "conflict"; message: string };

export function checkUndo(e: UndoableEntry, current: string): UndoCheck {
  if (e.undoneById) return { ok: false, reason: "already-undone", message: "Ten wpis został już cofnięty." };
  if (!isUndoable(e)) return { ok: false, reason: "not-undoable", message: "Tego typu zmiany nie da się cofnąć automatycznie." };
  if (!sameLogValue(current, e.after)) {
    return { ok: false, reason: "conflict", message: "Konflikt: wartość zmieniła się od tego wpisu — cofnięcie nadpisałoby nowszą zmianę." };
  }
  return { ok: true };
}
