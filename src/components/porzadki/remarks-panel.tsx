"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/components/clients/client-forms";
import { ClientPicker } from "@/components/clients/history-review";
import type { ReviewClient } from "@/lib/history/review-load";
import type { RemarkRow } from "@/lib/porzadki/remarks";
import { AREA_KEYS, AREA_LABEL, REMARK_STATUS_LABEL, TYPE_KEYS, TYPE_LABEL, proposalNumber, type AreaKey, type ProposalTypeKey } from "@/lib/porzadki/labels";
import { BTN, BTN_GHOST, BTN_PRIMARY, ErrorNote, INPUT, SELECT_PILL, TEXTAREA, fmtDateTime } from "./shared";

// Uwagi — lista z filtrami + dodawanie. Na /uwagi (wszystkie) i na karcie
// klienta (clientId ustalony, wersja kompaktowa). „Przekształć we wniosek”
// kopiuje pola do nowego wniosku, a uwaga dostaje do niego link.

export function RemarksPanel({ clientId, clientOptions = [], compact = false }: { clientId?: string; clientOptions?: ReviewClient[]; compact?: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<RemarkRow[] | null>(null);
  const [status, setStatus] = useState<"" | "OPEN" | "CLOSED">(compact ? "" : "OPEN");
  const [area, setArea] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ body: "", area: "" as AreaKey | "", evidence: "", client: null as { id: string; name: string } | null });
  const [picking, setPicking] = useState(false);
  const [converting, setConverting] = useState<{ id: string; area: AreaKey | ""; type: ProposalTypeKey } | null>(null);
  const [busy, setBusy] = useState(false);

  const query = new URLSearchParams({ ...(clientId ? { klient: clientId } : {}), ...(status ? { status } : {}), ...(area ? { obszar: area } : {}), ...(q.trim() ? { q: q.trim() } : {}) }).toString();

  const fetchRows = useCallback(async () => {
    const { ok, data } = await api<{ remarks: RemarkRow[] }>(`/api/porzadki/uwagi?${query}`, "GET");
    return ok ? { rows: data.remarks } : { error: data.message ?? "Nie udało się wczytać uwag." };
  }, [query]);

  const apply = (r: { rows: RemarkRow[] } | { error: string }) => ("rows" in r ? setRows(r.rows) : setError(r.error));

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => void fetchRows().then((r) => alive && apply(r)), 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [fetchRows]);

  async function add() {
    setBusy(true);
    setError(null);
    const { ok, data } = await api("/api/porzadki/uwagi", "POST", {
      body: draft.body,
      area: draft.area || null,
      evidence: draft.evidence,
      clientId: clientId ?? draft.client?.id ?? null,
    });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać.");
    setDraft({ body: "", area: "", evidence: "", client: null });
    setAdding(false);
    apply(await fetchRows());
  }

  async function setRemarkStatus(r: RemarkRow, next: "OPEN" | "CLOSED") {
    const { ok, data } = await api(`/api/porzadki/uwagi/${r.id}`, "PATCH", { status: next });
    if (!ok) return setError(data.message ?? "Nie udało się.");
    apply(await fetchRows());
  }

  async function convert() {
    if (!converting) return;
    setBusy(true);
    const { ok, data } = await api<{ id: string }>(`/api/porzadki/uwagi/${converting.id}/wniosek`, "POST", { area: converting.area, type: converting.type });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się utworzyć wniosku.");
    router.push(`/wnioski/${data.id}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {!compact && <input className={`${INPUT} h-8 max-w-[240px] text-[13px]`} placeholder="Szukaj w treści…" value={q} onChange={(e) => setQ(e.target.value)} />}
        {(["OPEN", "CLOSED", ""] as const).map((s) => (
          <button key={s || "all"} type="button" className={SELECT_PILL(status === s)} onClick={() => setStatus(s)}>
            {s ? REMARK_STATUS_LABEL[s] : "wszystkie"}
          </button>
        ))}
        {!compact && (
          <select className={SELECT_PILL(!!area)} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Obszar: wszystkie</option>
            {AREA_KEYS.map((k) => (
              <option key={k} value={k}>
                {AREA_LABEL[k]}
              </option>
            ))}
          </select>
        )}
        {!adding && (
          <button type="button" className={`${compact ? BTN_GHOST : BTN_PRIMARY} ml-auto`} onClick={() => setAdding(true)}>
            + Dodaj uwagę
          </button>
        )}
      </div>

      {adding && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--c-brand)] bg-white p-3">
          <textarea autoFocus rows={3} className={TEXTAREA} placeholder="Obserwacja, notatka albo podejrzenie…" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={INPUT} value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value as AreaKey | "" })}>
              <option value="">Obszar (opcjonalnie)</option>
              {AREA_KEYS.map((k) => (
                <option key={k} value={k}>
                  {AREA_LABEL[k]}
                </option>
              ))}
            </select>
            <input className={INPUT} placeholder="Dowód / źródło (opcjonalnie)" value={draft.evidence} onChange={(e) => setDraft({ ...draft, evidence: e.target.value })} />
          </div>
          {!clientId && (
            <div className="relative flex items-center gap-2 text-[13px]">
              {draft.client ? (
                <>
                  Klient: <b className="font-semibold">{draft.client.name}</b>
                  <button type="button" className="text-xs text-[var(--c-muted)] hover:text-[var(--c-red)]" onClick={() => setDraft({ ...draft, client: null })}>
                    usuń
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setPicking(true)} className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                  + powiąż z klientem (opcjonalnie)
                </button>
              )}
              {picking && (
                <ClientPicker
                  clients={clientOptions}
                  onClose={() => setPicking(false)}
                  onPick={(id) => {
                    const c = clientOptions.find((x) => x.id === id);
                    if (c) setDraft({ ...draft, client: { id: c.id, name: c.name } });
                    setPicking(false);
                  }}
                />
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN_GHOST} onClick={() => setAdding(false)}>
              Anuluj
            </button>
            <button type="button" className={BTN_PRIMARY} disabled={busy || !draft.body.trim()} onClick={() => void add()}>
              Zapisz uwagę
            </button>
          </div>
        </div>
      )}

      <ErrorNote message={error} />

      {rows === null ? (
        <p className="text-sm text-[var(--c-muted)]">Wczytywanie…</p>
      ) : rows.length === 0 ? (
        <p className={compact ? "text-[13px] text-[var(--c-faint)]" : "rounded-xl border border-[var(--c-border)] bg-white px-6 py-10 text-center text-sm text-[var(--c-muted)]"}>Brak uwag.</p>
      ) : (
        <ul className={compact ? "flex flex-col gap-2" : "overflow-hidden rounded-xl border border-[var(--c-border)] bg-white"}>
          {rows.map((r, i) => (
            <li
              key={r.id}
              className={compact ? "rounded-[10px] border border-[var(--c-border)] px-3 py-2.5" : `px-4 py-3 ${i > 0 ? "border-t border-[var(--c-border)]" : ""}`}
            >
              <div className="flex flex-wrap items-start gap-2">
                <p className={`min-w-0 flex-[1_1_300px] whitespace-pre-wrap text-[14px] ${r.status === "CLOSED" ? "text-[var(--c-muted)] line-through decoration-[var(--c-faint)]" : ""}`}>{r.body}</p>
                <span className="flex flex-none flex-wrap items-center gap-2 text-xs">
                  {r.proposalId ? (
                    <Link href={`/wnioski/${r.proposalId}`} className="rounded-md bg-[var(--c-purple-soft)] px-1.5 py-0.5 font-semibold text-[var(--c-purple-deep)]">
                      → {proposalNumber(r.proposalNumber ?? 0)}
                    </Link>
                  ) : (
                    <button type="button" className="font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]" onClick={() => setConverting({ id: r.id, area: r.area ?? "", type: "JAKOSC_DANYCH" })}>
                      Przekształć we wniosek
                    </button>
                  )}
                  {r.canEdit && (
                    <button type="button" className="text-[var(--c-muted)] hover:text-[var(--c-text)]" onClick={() => void setRemarkStatus(r, r.status === "OPEN" ? "CLOSED" : "OPEN")}>
                      {r.status === "OPEN" ? "Zamknij" : "Otwórz ponownie"}
                    </button>
                  )}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--c-muted)]">
                {r.authorName ?? "—"} · {fmtDateTime(r.createdAt)}
                {r.area && ` · ${AREA_LABEL[r.area]}`}
                {!clientId && r.clientId && (
                  <>
                    {" · "}
                    <Link href={`/klienci/${r.clientId}`} className="text-[var(--c-brand)] hover:underline">
                      {r.clientName}
                    </Link>
                  </>
                )}
                {r.leadId && (
                  <>
                    {" · "}
                    <Link href={`/sygnaly?id=${r.leadId}`} className="text-[var(--c-brand)] hover:underline">
                      sygnał: {r.leadTitle}
                    </Link>
                  </>
                )}
              </p>
              {r.evidence && <p className="mt-0.5 whitespace-pre-wrap text-xs text-[var(--c-sidebar-text)]">Dowód: {r.evidence}</p>}
              {converting?.id === r.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--c-bg)] p-2">
                  <select className={`${INPUT} h-8 max-w-[260px] text-[13px]`} value={converting.area} onChange={(e) => setConverting({ ...converting, area: e.target.value as AreaKey | "" })}>
                    <option value="">Obszar wniosku…</option>
                    {AREA_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {AREA_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <select className={`${INPUT} h-8 max-w-[220px] text-[13px]`} value={converting.type} onChange={(e) => setConverting({ ...converting, type: e.target.value as ProposalTypeKey })}>
                    {TYPE_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {TYPE_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className={`${BTN_PRIMARY} h-8`} disabled={busy || !converting.area} onClick={() => void convert()}>
                    Utwórz wniosek
                  </button>
                  <button type="button" className={`${BTN} h-8`} onClick={() => setConverting(null)}>
                    Anuluj
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
