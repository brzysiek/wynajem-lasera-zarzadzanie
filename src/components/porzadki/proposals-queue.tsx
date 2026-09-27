"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/components/clients/client-forms";
import type { ChangeProposalRow, DecisionResult } from "@/lib/porzadki/change-proposals";
import { PROPOSAL_KIND_LABEL, PROPOSAL_STATUS_LABEL, type ChangeProposalStatus } from "@/lib/porzadki/proposal-rules";
import { ARCHIVE_REASON_LABEL, FIELD_LABEL, type ArchiveReasonKey } from "@/lib/porzadki/labels";
import { CONFIDENCE_LABEL, type Confidence } from "@/lib/changelog/provenance";
import { readable } from "./changelog-panel";
import { BTN, BTN_PRIMARY, ErrorNote, INPUT, SELECT_PILL, fmtDateTime } from "./shared";
import { BlobsPanel } from "./blobs-panel";

// Porządki → Propozycje: kolejka zmian zgłoszonych przez agenta, pogrupowana
// w paczki. ADMIN: akceptuj / odrzuć (pojedynczo i hurtem), popraw wartość,
// zatwierdzaj klasę na stałe. Akceptacja wykonuje zmianę od razu.

type AutoClass = { key: string; label: string | null };

const CONF_TONE: Record<string, string> = {
  HIGH: "bg-[var(--c-green-soft)] text-[var(--c-green-deep)]",
  MEDIUM: "bg-[var(--c-gold-soft)] text-[var(--c-gold-deep)]",
  LOW: "bg-[var(--c-red-soft)] text-[var(--c-red)]",
};

function describe(p: ChangeProposalRow): { what: string; from: string | null; to: string } {
  if (p.kind === "ARCHIVE") {
    const v = p.proposedValue ? (JSON.parse(p.proposedValue) as { reason: ArchiveReasonKey; note: string }) : null;
    return { what: p.leadId ? `sygnał do archiwum: ${p.leadTitle ?? ""}` : "do archiwum", from: null, to: v ? `${ARCHIVE_REASON_LABEL[v.reason] ?? v.reason} — ${v.note}` : "—" };
  }
  if (p.kind === "SPLIT") {
    const v = p.proposedValue ? (JSON.parse(p.proposedValue) as { name: string; contactNames?: string[]; invoiceNip?: string | null; historyKeys?: string[] }) : null;
    const extras = [v?.invoiceNip ? `faktury z NIP ${v.invoiceNip}` : null, v?.historyKeys?.length ? `${v.historyKeys.length} grup z dopasowań` : null].filter(Boolean).join(", ");
    return { what: `wydziel: ${v?.contactNames?.join(", ") ?? "osoby"}`, from: null, to: `nowy klient „${v?.name ?? "?"}”${extras ? ` (+ ${extras})` : ""}` };
  }
  if (p.kind === "EXCLUSION") {
    const v = p.proposedValue ? (JSON.parse(p.proposedValue) as { values: string[]; kind: "EXCLUDE" | "HIDE"; note: string | null }) : null;
    const list = v?.values ?? [];
    return {
      what: v?.kind === "HIDE" ? "ukrywaj w historii klienta" : "lista wykluczeń domen",
      from: null,
      to: `${list.slice(0, 12).join(", ")}${list.length > 12 ? ` … (+${list.length - 12})` : ""}${v?.note ? ` — ${v.note}` : ""}`,
    };
  }
  if (p.kind === "PAYMENT_MATCH") {
    const v = p.proposedValue
      ? (JSON.parse(p.proposedValue) as { invoiceNumber?: string; invoiceGross?: string; buyerName?: string; transfer?: { date: string; amount: string; description: string } })
      : null;
    return {
      what: `przelew → faktura ${v?.invoiceNumber ?? ""}`,
      from: null,
      to: `${v?.transfer ? `${v.transfer.date} · ${v.transfer.amount} zł · ${v.transfer.description}` : "przelew"} → FV ${v?.invoiceNumber ?? "?"} (${v?.buyerName ?? ""}, ${v?.invoiceGross ?? "?"} zł brutto)`,
    };
  }
  if (p.kind === "MERGE") {
    const v = p.proposedValue ? (JSON.parse(p.proposedValue) as { duplicateId: string }) : null;
    return { what: "scal duplikat w tego klienta", from: null, to: p.duplicateName ? `${p.duplicateName} (${v?.duplicateId})` : (v?.duplicateId ?? "—") };
  }
  const field = FIELD_LABEL[p.field ?? ""] ?? p.field ?? "";
  return { what: p.kind === "CONTACT_FIELD" ? `${p.contactName ?? "osoba"} · ${field}` : field, from: readable(p.currentValue), to: readable(p.proposedValue) };
}

export function ProposalsQueue({ canDecide, initialClientId }: { canDecide: boolean; initialClientId: string | null }) {
  const [status, setStatus] = useState<ChangeProposalStatus | "">("PENDING");
  const [rows, setRows] = useState<ChangeProposalRow[] | null>(null);
  const [classes, setClasses] = useState<AutoClass[]>([]);
  const [batch, setBatch] = useState("");
  const [onlyHigh, setOnlyHigh] = useState(false);
  const [kind, setKind] = useState("");
  const [clientId, setClientId] = useState(initialClientId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Map<string, string | null>>(new Map());

  const query = new URLSearchParams({ ...(status ? { status } : {}), ...(clientId ? { klient: clientId } : {}) }).toString();
  const fetchAll = useCallback(async () => {
    const [p, c] = await Promise.all([
      api<{ proposals: ChangeProposalRow[] }>(`/api/porzadki/propozycje?${query}`, "GET"),
      api<{ classes: AutoClass[] }>("/api/porzadki/propozycje/klasy", "GET"),
    ]);
    return { rows: p.ok ? p.data.proposals : null, classes: c.ok ? c.data.classes : [], error: p.ok ? null : (p.data.message ?? "Nie udało się wczytać propozycji.") };
  }, [query]);
  const apply = (r: { rows: ChangeProposalRow[] | null; classes: AutoClass[]; error: string | null }) => {
    if (r.rows) setRows(r.rows);
    setClasses(r.classes);
    setError(r.error);
    setSelected(new Set());
  };

  useEffect(() => {
    let alive = true;
    void fetchAll().then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [fetchAll]);

  const batches = useMemo(() => [...new Set((rows ?? []).map((r) => r.batch ?? ""))].sort().reverse(), [rows]);
  const visible = useMemo(
    () => (rows ?? []).filter((r) => (!batch || (r.batch ?? "") === batch) && (!onlyHigh || r.confidence === "HIGH") && (!kind || r.kind === kind)),
    [rows, batch, onlyHigh, kind],
  );
  const groups = useMemo(() => {
    const m = new Map<string, ChangeProposalRow[]>();
    for (const r of visible) m.set(r.batch ?? "", [...(m.get(r.batch ?? "") ?? []), r]);
    return [...m.entries()];
  }, [visible]);
  const pendingVisible = visible.filter((r) => r.status === "PENDING");
  const autoKeys = new Set(classes.map((c) => c.key));

  async function decide(ids: string[], action: "accept" | "reject", force = false) {
    if (!ids.length) return;
    let comment: string | null = null;
    if (action === "reject") {
      comment = window.prompt(`Odrzucić ${ids.length} propozycji? Komentarz dla agenta (dlaczego — żeby nie proponował tego ponownie):`, "");
      if (comment === null) return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const { ok, data } = await api<DecisionResult>("/api/porzadki/propozycje/decyzja", "POST", { ids, action, comment, force });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się.");
    const parts = [
      data.accepted ? `zaakceptowano i wykonano: ${data.accepted}` : null,
      data.rejected ? `odrzucono: ${data.rejected}` : null,
      data.conflicts.length ? `pominięto ${data.conflicts.length} — wartość zmieniła się od zgłoszenia` : null,
      data.failed.length ? `nie wykonano: ${data.failed.length} (${data.failed[0].message})` : null,
    ].filter(Boolean);
    setInfo(parts.join(" · ") || "Bez zmian.");
    setConflicts(new Map(data.conflicts.map((c) => [c.id, c.current])));
    apply(await fetchAll());
  }

  async function saveEdit() {
    if (!editing) return;
    const row = rows?.find((r) => r.id === editing.id);
    const text = editing.value.trim();
    // Zainteresowania to lista kodów — „COOLTECH, ALMA_HARMONY”.
    const value: unknown =
      row?.field === "deviceInterests" ? text.split(/[,\s]+/).filter(Boolean).map((x) => x.toUpperCase()) : text === "" ? null : text;
    setBusy(true);
    const { ok, data } = await api(`/api/porzadki/propozycje/${editing.id}`, "PATCH", { value });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się poprawić.");
    setEditing(null);
    apply(await fetchAll());
  }

  async function autoClass(key: string, add: boolean) {
    if (add && !window.confirm(`Zatwierdzać na stałe klasę „${key}”? Kolejne propozycje pól z tą klasą agent wykona sam (wpisy nadal w dzienniku).`)) return;
    const { ok, data } = add
      ? await api<{ classes: AutoClass[] }>("/api/porzadki/propozycje/klasy", "POST", { key })
      : await api<{ classes: AutoClass[] }>(`/api/porzadki/propozycje/klasy?key=${encodeURIComponent(key)}`, "DELETE");
    if (!ok) return setError(data.message ?? "Nie udało się.");
    setClasses(data.classes);
  }

  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  return (
    <div className="flex flex-col gap-3">
      <BlobsPanel />
      <div className="flex flex-wrap items-center gap-2">
        {(["PENDING", "ACCEPTED", "REJECTED", ""] as const).map((s) => (
          <button key={s || "all"} type="button" className={SELECT_PILL(status === s)} onClick={() => setStatus(s)}>
            {s ? PROPOSAL_STATUS_LABEL[s] : "wszystkie"}
          </button>
        ))}
        <select className={SELECT_PILL(!!batch)} value={batch} onChange={(e) => setBatch(e.target.value)}>
          <option value="">Paczka: wszystkie</option>
          {batches.map((b) => (
            <option key={b || "none"} value={b}>
              {b || "(bez paczki)"}
            </option>
          ))}
        </select>
        <select className={SELECT_PILL(!!kind)} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Rodzaj: każdy</option>
          {Object.entries(PROPOSAL_KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button type="button" className={SELECT_PILL(onlyHigh)} onClick={() => setOnlyHigh((v) => !v)}>
          tylko wysoka pewność
        </button>
        {clientId && (
          <button type="button" className={SELECT_PILL(true)} onClick={() => setClientId(null)}>
            jeden klient ✕
          </button>
        )}
      </div>

      {canDecide && status === "PENDING" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--c-bg)] px-3 py-2 text-[13px]">
          <label className="flex items-center gap-1.5 text-[var(--c-muted)]">
            <input
              type="checkbox"
              checked={pendingVisible.length > 0 && pendingVisible.every((r) => selected.has(r.id))}
              onChange={(e) => toggle(pendingVisible.map((r) => r.id), e.target.checked)}
            />
            zaznacz wszystkie ({pendingVisible.length})
          </label>
          <span className="text-[var(--c-muted)]">· zaznaczone: {selected.size}</span>
          <button type="button" className={`${BTN_PRIMARY} ml-auto h-8 text-[13px]`} disabled={busy || !selected.size} onClick={() => void decide([...selected], "accept")}>
            Akceptuj zaznaczone
          </button>
          <button type="button" className={`${BTN} h-8 text-[13px] hover:border-[var(--c-red)] hover:text-[var(--c-red)]`} disabled={busy || !selected.size} onClick={() => void decide([...selected], "reject")}>
            Odrzuć zaznaczone
          </button>
        </div>
      )}

      <ErrorNote message={error} />
      {info && <p className="rounded-lg bg-[var(--c-green-soft)] px-3 py-2 text-[13px] text-[var(--c-green-deep)]">{info}</p>}

      {rows === null ? (
        <p className="text-sm text-[var(--c-muted)]">Wczytywanie…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-[var(--c-border)] bg-white px-6 py-10 text-center text-sm text-[var(--c-muted)]">
          {status === "PENDING" ? "Nic nie czeka na akceptację." : "Brak propozycji."}
        </p>
      ) : (
        groups.map(([b, list]) => {
          const pend = list.filter((r) => r.status === "PENDING");
          return (
            <section key={b || "none"} className="overflow-hidden rounded-xl border border-[var(--c-border)] bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--c-border)] bg-[var(--c-bg)] px-4 py-2 text-[13px]">
                {canDecide && pend.length > 0 && <input type="checkbox" checked={pend.every((r) => selected.has(r.id))} onChange={(e) => toggle(pend.map((r) => r.id), e.target.checked)} aria-label="Zaznacz paczkę" />}
                <b className="font-semibold text-[var(--c-navy)]">{b ? `Paczka ${b}` : "Bez paczki"}</b>
                <span className="text-[var(--c-muted)]">
                  {list.length} {list.length === 1 ? "propozycja" : "propozycji"}
                  {pend.length ? ` · oczekuje ${pend.length}` : ""}
                </span>
              </div>
              {list.map((r, i) => {
                const d = describe(r);
                const conflict = conflicts.get(r.id);
                return (
                  <div key={r.id} className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? "border-t border-[var(--c-border)]" : ""}`}>
                    {canDecide && r.status === "PENDING" && <input type="checkbox" className="mt-1" checked={selected.has(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} />}
                    <div className="min-w-0 flex-grow text-[13.5px]">
                      <p>
                        {r.clientId ? (
                          <Link href={`/klienci/${r.clientId}`} className="font-semibold text-[var(--c-navy)] hover:underline">
                            {r.clientName ?? "klient"}
                          </Link>
                        ) : (
                          <span className="font-semibold text-[var(--c-navy)]">{r.leadTitle ?? "—"}</span>
                        )}
                        <span className="ml-2 text-[var(--c-muted)]">
                          {PROPOSAL_KIND_LABEL[r.kind]} · {d.what}
                        </span>
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CONF_TONE[r.confidence] ?? ""}`}>{CONFIDENCE_LABEL[r.confidence as Confidence] ?? r.confidence}</span>
                        {r.changeClass && (
                          <span className="ml-1.5 rounded-full bg-[var(--c-purple-soft)] px-2 py-0.5 text-[11px] text-[var(--c-purple-deep)]">
                            {r.changeClass}
                            {autoKeys.has(r.changeClass) ? " · automatycznie" : ""}
                          </span>
                        )}
                      </p>
                      {editing?.id === r.id ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <input autoFocus className={`${INPUT} h-8 max-w-[320px] text-[13px]`} value={editing.value} onChange={(e) => setEditing({ id: r.id, value: e.target.value })} />
                          <button type="button" className={`${BTN_PRIMARY} h-8 text-[13px]`} disabled={busy} onClick={() => void saveEdit()}>
                            Zapisz
                          </button>
                          <button type="button" className={`${BTN} h-8 text-[13px]`} onClick={() => setEditing(null)}>
                            Anuluj
                          </button>
                        </div>
                      ) : (
                        <p className="mt-0.5 break-words">
                          {d.from !== null && (
                            <>
                              <span className="text-[var(--c-muted)] line-through decoration-[var(--c-faint)]">{d.from}</span>
                              <span className="mx-1.5 text-[var(--c-faint)]">→</span>
                            </>
                          )}
                          <b className="font-semibold">{d.to}</b>
                          {r.edited && <span className="ml-1.5 text-xs text-[var(--c-muted)]">(poprawione)</span>}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-[var(--c-sidebar-text)]">Źródło: {r.source}</p>
                      {conflict !== undefined && (
                        <p className="mt-1 text-xs text-[var(--c-red)]">
                          Wartość zmieniła się od zgłoszenia — obecnie „{readable(conflict)}”.{" "}
                          <button type="button" className="font-semibold underline" onClick={() => void decide([r.id], "accept", true)}>
                            Akceptuj mimo to
                          </button>
                        </p>
                      )}
                      {r.executionError && <p className="mt-1 text-xs text-[var(--c-red)]">Nie wykonano: {r.executionError}</p>}
                      {r.status !== "PENDING" && (
                        <p className="mt-1 text-xs text-[var(--c-muted)]">
                          {PROPOSAL_STATUS_LABEL[r.status]}
                          {r.autoApproved ? " automatycznie" : r.decidedByName ? ` · ${r.decidedByName}` : ""}
                          {r.decidedAt ? ` · ${fmtDateTime(r.decidedAt)}` : ""}
                          {r.decisionComment ? ` — „${r.decisionComment}”` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-none flex-col items-end gap-1 text-xs">
                      <span className="text-[var(--c-faint)]">
                        {r.authorName ?? "—"} · {fmtDateTime(r.createdAt)}
                      </span>
                      {canDecide && r.status === "PENDING" && (
                        <span className="flex flex-wrap justify-end gap-2">
                          <button type="button" className="font-semibold text-[var(--c-green-deep)] hover:underline" disabled={busy} onClick={() => void decide([r.id], "accept")}>
                            Akceptuj
                          </button>
                          <button type="button" className="font-semibold text-[var(--c-red)] hover:underline" disabled={busy} onClick={() => void decide([r.id], "reject")}>
                            Odrzuć
                          </button>
                          {(r.kind === "FIELD" || r.kind === "CONTACT_FIELD") && (
                            <button
                              type="button"
                              className="font-semibold text-[var(--c-brand)] hover:underline"
                              onClick={() => {
                                const v = r.proposedValue ? JSON.parse(r.proposedValue) : "";
                                setEditing({ id: r.id, value: Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v) });
                              }}
                            >
                              Edytuj
                            </button>
                          )}
                        </span>
                      )}
                      {canDecide && r.changeClass && !autoKeys.has(r.changeClass) && (r.kind === "FIELD" || r.kind === "CONTACT_FIELD") && (
                        <button type="button" className="text-[var(--c-purple-deep)] hover:underline" onClick={() => void autoClass(r.changeClass!, true)}>
                          Zatwierdzaj tę klasę na stałe
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })
      )}

      <section className="rounded-xl border border-[var(--c-border)] bg-white px-4 py-3">
        <h2 className="m-0 text-[15px] font-semibold text-[var(--c-navy)]">Klasy zatwierdzane automatycznie</h2>
        <p className="mt-0.5 text-xs text-[var(--c-muted)]">Propozycje zmian pól z tymi klasami agent wykonuje sam — wpisy nadal trafiają do dziennika. Archiwizacja i scalanie zawsze czekają na akceptację.</p>
        {classes.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--c-faint)]">Brak. Dodasz klasę przyciskiem „Zatwierdzaj tę klasę na stałe” przy propozycji.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {classes.map((c) => (
              <li key={c.key} className="inline-flex items-center gap-1 rounded-full bg-[var(--c-purple-soft)] py-0.5 pl-2.5 pr-1 text-xs text-[var(--c-purple-deep)]">
                {c.key}
                {canDecide && (
                  <button type="button" aria-label={`Usuń klasę ${c.key}`} className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-white" onClick={() => void autoClass(c.key, false)}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
