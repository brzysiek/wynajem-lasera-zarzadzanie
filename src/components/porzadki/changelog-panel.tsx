"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import { api } from "@/components/clients/client-forms";
import type { ChangeLogRow } from "@/lib/changelog/load";
import { ENTITY_LABEL, FIELD_LABEL, OPERATION_LABEL } from "@/lib/porzadki/labels";
import { CONFIDENCE_LABEL, type Confidence } from "@/lib/changelog/provenance";
import { BTN, ErrorNote, INPUT, SELECT_PILL, fmtDateTime } from "./shared";

// Dziennik zmian: /dziennik (filtry, eksport CSV) i sekcja „Historia
// porządków” na karcie klienta (clientId ustalony, wersja kompaktowa).
// „Cofnij” — tylko ADMIN; przy konflikcie pokazuje bieżącą wartość.

const MATCH_STATE: Record<string, string> = {
  AUTO: "automatycznie",
  CONFIRMED: "potwierdzone",
  SUGGESTED: "propozycja",
  UNMATCHED: "bez dopasowania",
  IGNORED: "pominięte",
};
const QUALIFY_REASON: Record<string, string> = { CALL: "rozmowa", EMAIL_REPLY: "odpowiedź mailem", RENTAL: "wynajem", HISTORY: "historia", MANUAL: "ręcznie", BACKFILL: "import", HUBSPOT: "HubSpot" };

function scalar(k: string, x: unknown): string {
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}T/.test(x)) return new Date(x).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
  if (k === "matchState" && typeof x === "string") return MATCH_STATE[x] ?? x;
  if (k === "qualifiedReason" && typeof x === "string") return QUALIFY_REASON[x] ?? x;
  if (k === "clientId") return "przypisany";
  return typeof x === "object" ? JSON.stringify(x) : String(x);
}

function readable(raw: string | null): string {
  if (raw == null) return "—";
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (v === null || v === "") return "(puste)";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x != null && x !== "")
      .map(([k, x]) => `${FIELD_LABEL[k] ?? k}: ${scalar(k, x)}`)
      .join(" · ") || "(puste)";
  }
  if (typeof v === "boolean") return v ? "tak" : "nie";
  return String(v);
}

export function ChangeLogPanel({
  clientId,
  compact = false,
  canUndo,
  users = [],
}: {
  clientId?: string;
  compact?: boolean;
  canUndo: boolean;
  users?: { id: string; name: string }[];
}) {
  const [rows, setRows] = useState<ChangeLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ q: "", batch: "", userId: "", entity: "", from: "", to: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const query = new URLSearchParams({
    ...(clientId ? { klient: clientId } : {}),
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
    ...(f.batch.trim() ? { paczka: f.batch.trim() } : {}),
    ...(f.userId ? { autor: f.userId } : {}),
    ...(f.entity ? { obiekt: f.entity } : {}),
    ...(f.from ? { od: f.from } : {}),
    ...(f.to ? { do: f.to } : {}),
    ...(compact ? { limit: "30" } : {}),
  }).toString();

  const fetchRows = useCallback(async () => {
    const { ok, data } = await api<{ entries: ChangeLogRow[] }>(`/api/porzadki/dziennik?${query}`, "GET");
    return ok ? { rows: data.entries } : { error: data.message ?? "Nie udało się wczytać dziennika." };
  }, [query]);
  const apply = (r: { rows: ChangeLogRow[] } | { error: string }) => ("rows" in r ? setRows(r.rows) : setError(r.error));

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => void fetchRows().then((r) => alive && apply(r)), 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [fetchRows]);

  async function undo(r: ChangeLogRow) {
    if (!window.confirm(`Cofnąć tę zmianę? Przywrócę wartość „${readable(r.before)}”.`)) return;
    setBusy(r.id);
    setError(null);
    const { ok, data } = await api<{ conflict?: { current: string } | null }>(`/api/porzadki/dziennik/${r.id}/cofnij`, "POST");
    setBusy(null);
    if (!ok) {
      const current = data.conflict?.current;
      setError(`${data.message ?? "Nie udało się cofnąć."}${current !== undefined ? ` Obecnie: „${readable(current)}”.` : ""}`);
      return;
    }
    apply(await fetchRows());
  }

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <div className="flex flex-col gap-3">
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${INPUT} h-8 max-w-[220px] text-[13px]`} placeholder="Klient, źródło, wartość…" value={f.q} onChange={(e) => set("q", e.target.value)} />
          <input className={`${INPUT} h-8 max-w-[170px] text-[13px]`} placeholder="Paczka, np. P-2026-09-27-01" value={f.batch} onChange={(e) => set("batch", e.target.value)} />
          <select className={SELECT_PILL(!!f.userId)} value={f.userId} onChange={(e) => set("userId", e.target.value)}>
            <option value="">Wykonał: każdy</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select className={SELECT_PILL(!!f.entity)} value={f.entity} onChange={(e) => set("entity", e.target.value)}>
            <option value="">Obiekt: każdy</option>
            {Object.entries(ENTITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-[var(--c-muted)]">
            od
            <input type="date" className={`${INPUT} h-8 w-[140px] text-[13px]`} value={f.from} onChange={(e) => set("from", e.target.value)} />
          </label>
          <label className="flex items-center gap-1 text-xs text-[var(--c-muted)]">
            do
            <input type="date" className={`${INPUT} h-8 w-[140px] text-[13px]`} value={f.to} onChange={(e) => set("to", e.target.value)} />
          </label>
          <a href={`${BASE_PATH}/api/porzadki/dziennik/export?${query}`} className={`${BTN} ml-auto flex h-8 items-center text-[13px]`}>
            Eksport CSV
          </a>
        </div>
      )}

      <ErrorNote message={error} />

      {rows === null ? (
        <p className="text-sm text-[var(--c-muted)]">Wczytywanie…</p>
      ) : rows.length === 0 ? (
        <p className={compact ? "text-[13px] text-[var(--c-faint)]" : "rounded-xl border border-[var(--c-border)] bg-white px-6 py-10 text-center text-sm text-[var(--c-muted)]"}>
          Brak wpisów{compact ? " — zmiany danych tego klienta pojawią się tutaj." : "."}
        </p>
      ) : (
        <ul className={compact ? "flex flex-col" : "overflow-hidden rounded-xl border border-[var(--c-border)] bg-white"}>
          {rows.map((r, i) => (
            <li key={r.id} className={`flex flex-wrap items-start gap-x-4 gap-y-1 ${compact ? "py-2" : "px-4 py-2.5"} ${i > 0 ? "border-t border-[var(--c-border)]" : ""}`}>
              <div className="min-w-0 flex-[1_1_360px] text-[13.5px]">
                <p className="text-[var(--c-text)]">
                  <b className="font-semibold text-[var(--c-navy)]">{OPERATION_LABEL[r.operation] ?? r.operation}</b>
                  {" · "}
                  {ENTITY_LABEL[r.entity] ?? r.entity}
                  {r.field && ` · ${FIELD_LABEL[r.field] ?? r.field}`}
                  {!compact && r.clientName && (
                    <>
                      {" · "}
                      {r.clientId ? (
                        <Link href={`/klienci/${r.clientId}`} className="text-[var(--c-brand)] hover:underline">
                          {r.clientName}
                        </Link>
                      ) : (
                        r.clientName
                      )}
                    </>
                  )}
                </p>
                {(r.before !== null || r.after !== null) && (
                  <p className="break-words text-[13px]">
                    <span className="text-[var(--c-muted)] line-through decoration-[var(--c-faint)]">{readable(r.before)}</span>
                    <span className="mx-1.5 text-[var(--c-faint)]">→</span>
                    <span>{readable(r.after)}</span>
                  </p>
                )}
                {(r.source || r.confidence || r.batch) && (
                  <p className="text-xs text-[var(--c-sidebar-text)]">
                    {r.source && `Źródło: ${r.source}`}
                    {r.confidence && ` · pewność ${CONFIDENCE_LABEL[r.confidence as Confidence] ?? r.confidence}`}
                    {r.batch && ` · paczka ${r.batch}`}
                  </p>
                )}
              </div>
              <div className="flex flex-none items-center gap-3 text-xs text-[var(--c-faint)]">
                <span>
                  {r.userName ?? "—"} · {fmtDateTime(r.createdAt)}
                </span>
                {r.undoneById ? (
                  <span className="rounded-md bg-[var(--c-bg)] px-1.5 py-0.5 font-semibold text-[var(--c-muted)]">cofnięto</span>
                ) : (
                  canUndo &&
                  r.undoable && (
                    <button type="button" disabled={busy !== null} onClick={() => void undo(r)} className="font-semibold text-[var(--c-brand)] hover:text-[var(--c-red)] disabled:opacity-50">
                      {busy === r.id ? "Cofanie…" : "Cofnij"}
                    </button>
                  )
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {compact && rows && rows.length > 0 && (
        <Link href={`/dziennik?klient=${clientId}`} className="self-start text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
          Cały dziennik tego klienta →
        </Link>
      )}
    </div>
  );
}
