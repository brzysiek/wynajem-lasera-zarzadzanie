"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/components/clients/client-forms";
import type { ArchiveRow } from "@/lib/porzadki/archive";
import { ARCHIVE_REASON_KEYS, ARCHIVE_REASON_LABEL } from "@/lib/porzadki/labels";
import { BTN, ErrorNote, INPUT, SELECT_PILL, fmtDateTime } from "./shared";

// Porządki → Archiwum: filtry (typ, powód, paczka, kto, daty, szukaj),
// zaznaczanie wielu, „Przywróć” i „Usuń trwale” (tylko ADMIN; usunięcie z
// potwierdzeniem liczbą rekordów). Powiązania pokazane informacyjnie.

function Links({ l, type }: { l: ArchiveRow["links"]; type: ArchiveRow["type"] }) {
  const parts =
    type === "lead"
      ? [l.rentals ? "ma rezerwację" : null]
      : [
          l.rentals ? `wynajmy: ${l.rentals}` : null,
          l.invoices ? `faktury: ${l.invoices}` : null,
          l.history ? `historia: ${l.history}` : null,
          l.sms ? `SMS: ${l.sms}` : null,
          l.leads ? `sygnały: ${l.leads}` : null,
          l.emails ? `e-maile: ${l.emails}` : null,
        ];
  const text = parts.filter(Boolean).join(" · ");
  return text ? <span className="text-[var(--c-gold-deep)]">{text}</span> : <span className="text-[var(--c-faint)]">bez powiązań</span>;
}

export function ArchivePanel({ canManage, users }: { canManage: boolean; users: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<ArchiveRow[] | null>(null);
  const [f, setF] = useState({ typ: "", powod: "", paczka: "", kto: "", od: "", do: "", q: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = new URLSearchParams(Object.entries(f).filter(([, v]) => v.trim())).toString();
  const fetchRows = useCallback(async () => {
    const { ok, data } = await api<{ rows: ArchiveRow[] }>(`/api/porzadki/archiwum?${query}`, "GET");
    return ok ? { rows: data.rows } : { error: data.message ?? "Nie udało się wczytać archiwum." };
  }, [query]);
  const apply = (r: { rows: ArchiveRow[] } | { error: string }) => {
    if ("rows" in r) {
      setRows(r.rows);
      setSelected(new Set());
    } else setError(r.error);
  };

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => void fetchRows().then((r) => alive && apply(r)), 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [fetchRows]);

  const key = (r: ArchiveRow) => `${r.type}:${r.id}`;
  const chosen = useMemo(() => (rows ?? []).filter((r) => selected.has(key(r))), [rows, selected]);

  async function act(kind: "przywroc" | "usun") {
    if (chosen.length === 0) return;
    let confirm: number | undefined;
    if (kind === "usun") {
      const withLinks = chosen.filter((r) => Object.values(r.links).some((n) => n > 0)).length;
      const answer = window.prompt(
        `Trwale usunąć ${chosen.length} rekordów? Tego nie da się cofnąć.${withLinks ? `\n${withLinks} z nich ma powiązania (wynajmy, faktury, historię…) — te zostaną, bez powiązania z klientem.` : ""}\nSygnały i notatki tych klientów zostaną usunięte. W HubSpocie nic się nie zmieni (ID trafią na listę blokad importu).\n\nWpisz liczbę usuwanych rekordów (${chosen.length}), żeby potwierdzić:`,
      );
      if (answer === null) return;
      confirm = Number(answer.trim());
      if (confirm !== chosen.length) return setError("Liczba się nie zgadza — nic nie usunięto.");
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    let done = 0;
    for (const type of ["client", "lead"] as const) {
      const ids = chosen.filter((r) => r.type === type).map((r) => r.id);
      if (!ids.length) continue;
      const { ok, data } = await api<{ restored?: number; deleted?: number }>(`/api/porzadki/archiwum/${kind}`, "POST", { type, ids, ...(confirm !== undefined ? { confirm: ids.length } : {}) });
      if (!ok) {
        setError(data.message ?? "Nie udało się.");
        break;
      }
      done += data.restored ?? data.deleted ?? 0;
    }
    setBusy(false);
    if (done) setInfo(kind === "przywroc" ? `Przywrócono: ${done}.` : `Usunięto trwale: ${done}.`);
    apply(await fetchRows());
  }

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const allOn = rows !== null && rows.length > 0 && rows.every((r) => selected.has(key(r)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${INPUT} h-8 max-w-[220px] text-[13px]`} placeholder="Nazwa, miasto, NIP, e-mail…" value={f.q} onChange={(e) => set("q", e.target.value)} />
        <select className={SELECT_PILL(!!f.typ)} value={f.typ} onChange={(e) => set("typ", e.target.value)}>
          <option value="">Typ: wszystkie</option>
          <option value="client">klienci i kontakty z zapytań</option>
          <option value="lead">sygnały</option>
        </select>
        <select className={SELECT_PILL(!!f.powod)} value={f.powod} onChange={(e) => set("powod", e.target.value)}>
          <option value="">Powód: każdy</option>
          {ARCHIVE_REASON_KEYS.map((k) => (
            <option key={k} value={k}>
              {ARCHIVE_REASON_LABEL[k]}
            </option>
          ))}
        </select>
        <input className={`${INPUT} h-8 max-w-[160px] text-[13px]`} placeholder="Paczka" value={f.paczka} onChange={(e) => set("paczka", e.target.value)} />
        <select className={SELECT_PILL(!!f.kto)} value={f.kto} onChange={(e) => set("kto", e.target.value)}>
          <option value="">Zarchiwizował: każdy</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-[var(--c-muted)]">
          od
          <input type="date" className={`${INPUT} h-8 w-[140px] text-[13px]`} value={f.od} onChange={(e) => set("od", e.target.value)} />
        </label>
        <label className="flex items-center gap-1 text-xs text-[var(--c-muted)]">
          do
          <input type="date" className={`${INPUT} h-8 w-[140px] text-[13px]`} value={f.do} onChange={(e) => set("do", e.target.value)} />
        </label>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--c-bg)] px-3 py-2 text-[13px]">
          <span className="text-[var(--c-muted)]">Zaznaczone: {chosen.length}</span>
          <button type="button" className={`${BTN} h-8 text-[13px]`} disabled={busy || !chosen.length} onClick={() => void act("przywroc")}>
            Przywróć
          </button>
          <button type="button" className={`${BTN} h-8 text-[13px] hover:border-[var(--c-red)] hover:text-[var(--c-red)]`} disabled={busy || !chosen.length} onClick={() => void act("usun")}>
            Usuń trwale
          </button>
        </div>
      )}

      <ErrorNote message={error} />
      {info && <p className="rounded-lg bg-[var(--c-green-soft)] px-3 py-2 text-[13px] text-[var(--c-green-deep)]">{info}</p>}

      {rows === null ? (
        <p className="text-sm text-[var(--c-muted)]">Wczytywanie…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-[var(--c-border)] bg-white px-6 py-10 text-center text-sm text-[var(--c-muted)]">Archiwum jest puste.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--c-border)] bg-white">
          {canManage && (
            <label className="flex items-center gap-2 border-b border-[var(--c-border)] px-4 py-2 text-xs text-[var(--c-muted)]">
              <input type="checkbox" checked={allOn} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map(key)) : new Set())} />
              zaznacz wszystkie ({rows.length})
            </label>
          )}
          {rows.map((r, i) => (
            <div key={key(r)} className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? "border-t border-[var(--c-border)]" : ""}`}>
              {canManage && (
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(key(r))}
                  onChange={(e) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(key(r));
                      else n.delete(key(r));
                      return n;
                    })
                  }
                />
              )}
              <div className="min-w-0 flex-grow">
                <p className="text-[14px]">
                  {r.type === "client" ? (
                    <Link href={`/klienci/${r.id}`} className="font-semibold text-[var(--c-navy)] hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    <Link href={`/sygnaly?id=${r.id}`} className="font-semibold text-[var(--c-navy)] hover:underline">
                      {r.name}
                    </Link>
                  )}
                  <span className="ml-2 rounded-full bg-[var(--c-bg)] px-2 py-0.5 text-[11px] text-[var(--c-muted)]">{r.kindLabel}</span>
                  {r.reason && <span className="ml-1.5 rounded-full bg-[var(--c-red-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--c-red)]">{ARCHIVE_REASON_LABEL[r.reason]}</span>}
                </p>
                {r.note && <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-[var(--c-sidebar-text)]">{r.note}</p>}
                <p className="mt-0.5 text-xs text-[var(--c-muted)]">
                  {r.detail && `${r.detail} · `}
                  <Links l={r.links} type={r.type} />
                </p>
              </div>
              <div className="flex-none text-right text-xs text-[var(--c-faint)]">
                <p>{r.archivedByName ?? "—"}</p>
                <p>{fmtDateTime(r.archivedAt)}</p>
                {r.batch && <p>paczka {r.batch}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
