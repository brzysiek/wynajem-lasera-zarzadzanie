// Archiwum — walidacja wejścia (czysty moduł, vitest, bez @/).
import { ARCHIVE_REASON_KEYS, type ArchiveReasonKey } from "./labels";

export type ArchiveType = "client" | "lead";

export type ArchiveInput = { reason: ArchiveReasonKey; note: string; batch: string | null };

export function parseArchiveInput(body: Record<string, unknown>): { ok: true; value: ArchiveInput } | { ok: false; message: string } {
  const reason = body.reason ?? body.powod;
  if (!ARCHIVE_REASON_KEYS.includes(reason as ArchiveReasonKey)) return { ok: false, message: `Powód: ${ARCHIVE_REASON_KEYS.join(", ")}.` };
  const noteRaw = body.note ?? body.dopisek;
  const note = typeof noteRaw === "string" ? noteRaw.trim().slice(0, 5000) : "";
  if (!note) return { ok: false, message: "Dopisz uzasadnienie (dopisek) — dlaczego do archiwum." };
  const batchRaw = body.batch ?? body.paczka;
  const batch = typeof batchRaw === "string" && batchRaw.trim() ? batchRaw.trim().slice(0, 64) : null;
  return { ok: true, value: { reason: reason as ArchiveReasonKey, note, batch } };
}

// Body tras archiwum: { type: "client" | "lead", ids: string[] } (maks. 500).
export function parseTypeIds(body: Record<string, unknown> | null): { type: ArchiveType; ids: string[] } | null {
  const type = body?.type === "client" || body?.type === "lead" ? body.type : null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 500) : [];
  return type && ids.length ? { type, ids } : null;
}
