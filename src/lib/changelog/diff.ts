// Porównanie wartości przed/po do dziennika zmian. Wartości zapisujemy jako
// JSON w tekście ("null" = puste pole), żeby „Cofnij” mogło je odtworzyć
// 1:1. Czysty moduł (bez Prismy).

export type FieldChange = { field: string; before: string; after: string };

type DecimalLike = { toFixed: (n?: number) => string; toString: () => string };

function isDecimalLike(v: unknown): v is DecimalLike {
  return typeof v === "object" && v !== null && "toFixed" in v && typeof (v as DecimalLike).toFixed === "function";
}

function normalize(v: unknown): unknown {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  if (isDecimalLike(v)) return v.toString();
  if (Array.isArray(v)) return v.length ? v.map(normalize) : null;
  return v;
}

export function toLogValue(v: unknown): string {
  return JSON.stringify(normalize(v));
}

// Pola z `patch`, których wartość faktycznie się zmienia względem `before`.
export function changedFields(before: Record<string, unknown>, patch: Record<string, unknown>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const prev = before[field];
    const b = toLogValue(prev);
    const a = toLogValue(value);
    if (a === b) continue;
    // Kwoty: Decimal „150” i wpisane „150.00” to ta sama wartość.
    if (isDecimalLike(prev) && typeof value === "string" && Number(prev.toString()) === Number(value)) continue;
    out.push({ field, before: b, after: a });
  }
  return out;
}

export function fromLogValue(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
