"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/components/clients/client-forms";
import type { ReviewClient } from "@/lib/history/review-load";
import type { ProposalDetail } from "@/lib/porzadki/proposals";
import {
  CAUSE_LABEL,
  PRIORITY_LABEL,
  RELATION_KEYS,
  RELATION_LABEL,
  STATUS_KEYS,
  STATUS_LABEL,
  TYPE_LABEL,
  proposalNumber,
  type ProposalStatusKey,
  type RelationKey,
} from "@/lib/porzadki/labels";
import { canSetStatus } from "@/lib/porzadki/rules";
import { ProposalForm } from "./proposal-form";
import type { AreaDef } from "@/lib/porzadki/areas";
import { BTN, BTN_PRIMARY, Card, ErrorNote, INPUT, PorzadkiLayout, PriorityBadge, StatusBadge, TEXTAREA, fmtDate, fmtDateTime } from "./shared";

// Szczegół wniosku: wszystkie pola, zmiana statusu (decyzyjne — tylko ADMIN),
// historia statusów, komentarze, powiązania, edycja (autor / ADMIN).

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.04em] text-[var(--c-faint)]">{label}</p>
      <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--c-text)]">{value}</p>
    </div>
  );
}

export function ProposalDetailView({
  initial,
  role,
  clientOptions,
  areas,
  others,
}: {
  initial: ProposalDetail;
  role: string;
  clientOptions: ReviewClient[];
  areas: AreaDef[];
  others: { id: string; number: number; title: string }[]; // do wyboru „duplikat czego” / powiązań
}) {
  const [p, setP] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toStatus, setToStatus] = useState<ProposalStatusKey | "">("");
  const [statusComment, setStatusComment] = useState("");
  const [duplicateOf, setDuplicateOf] = useState("");
  const [comment, setComment] = useState("");
  const [relKind, setRelKind] = useState<RelationKey>("DEPENDS_ON");
  const [relTo, setRelTo] = useState("");

  const allowed = STATUS_KEYS.filter((s) => canSetStatus(role, p.status, s));
  const otherOptions = others.filter((o) => o.id !== p.id);

  async function reload() {
    const { ok, data } = await api<ProposalDetail>(`/api/porzadki/wnioski/${p.id}`, "GET");
    if (ok) setP(data);
  }

  async function run(path: string, method: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    const { ok, data } = await api<ProposalDetail>(path, method, body);
    setBusy(false);
    if (!ok) {
      setError(data.message ?? "Nie udało się zapisać.");
      return false;
    }
    setP(data);
    return true;
  }

  async function changeStatus() {
    if (!toStatus) return;
    const ok = await run(`/api/porzadki/wnioski/${p.id}`, "PATCH", {
      status: toStatus,
      comment: statusComment,
      ...(toStatus === "DUPLIKAT" ? { duplicateOfId: duplicateOf } : {}),
    });
    if (ok) {
      setToStatus("");
      setStatusComment("");
      setDuplicateOf("");
    }
  }

  const header = (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <StatusBadge status={p.status} />
      <PriorityBadge priority={p.priority} />
      {!p.dev && <span className="rounded-md bg-[var(--c-purple-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--c-purple-deep)]">skrzynka Tomka — nie do implementacji</span>}
      {p.blocksCleanup && <span className="rounded-md bg-[var(--c-red-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--c-red)]">blokuje porządki</span>}
      {p.deployed && (
        <span className="rounded-md bg-[var(--c-green-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--c-green-deep)]" title="Tytuł commita wymienia ten wniosek">
          wdrożono w {p.deployed.commit} · {fmtDate(p.deployed.at)}
        </span>
      )}
    </span>
  );

  return (
    <PorzadkiLayout
      title={`${proposalNumber(p.number)} · ${p.title}`}
      description={`${p.areaLabel} · ${TYPE_LABEL[p.type]} · ${p.authorName ?? "—"}, ${fmtDate(p.createdAt)}`}
      actions={
        <>
          <Link href={p.dev ? "/wnioski" : "/skrzynka"} className={`${BTN} flex items-center`}>
            ← Lista
          </Link>
          {p.canEdit && !editing && (
            <button type="button" className={BTN} onClick={() => setEditing(true)}>
              Edytuj
            </button>
          )}
        </>
      }
    >
      <div className="mb-4">{header}</div>
      <ErrorNote message={error} />
      {editing ? (
        <ProposalForm
          proposalId={p.id}
          clientOptions={clientOptions}
          areas={areas}
          initial={{
            title: p.title,
            area: p.area,
            type: p.type,
            problem: p.problem ?? "",
            evidence: p.evidence ?? "",
            scale: p.scale ?? "",
            causes: p.causes,
            proposal: p.proposal ?? "",
            priority: p.priority,
            priorityReason: p.priorityReason ?? "",
            blocksCleanup: p.blocksCleanup,
            clients: p.clients,
          }}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <div className="flex flex-col gap-4">
                <Field label="Problem" value={p.problem} />
                <Field label="Dowód" value={p.evidence} />
                <Field label="Propozycja" value={p.proposal} />
                {p.decision && <Field label="Decyzja" value={p.decision} />}
                {!p.problem && !p.evidence && !p.proposal && <p className="text-sm text-[var(--c-faint)]">Brak opisu.</p>}
              </div>
            </Card>

            <Card title={`Komentarze (${p.comments.length})`}>
              <div className="flex flex-col gap-3">
                {p.comments.map((c) => (
                  <div key={c.id} className="text-[13.5px]">
                    <span className="font-semibold text-[var(--c-navy)]">{c.userName ?? "—"}</span>
                    <span className="ml-2 text-xs text-[var(--c-faint)]">{fmtDateTime(c.at)}</span>
                    <p className="whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}
                <textarea rows={2} className={TEXTAREA} placeholder="Dodaj komentarz…" value={comment} onChange={(e) => setComment(e.target.value)} />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy || !comment.trim()}
                    className={BTN_PRIMARY}
                    onClick={async () => (await run(`/api/porzadki/wnioski/${p.id}/komentarze`, "POST", { body: comment })) && setComment("")}
                  >
                    Dodaj komentarz
                  </button>
                </div>
              </div>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card title="Status">
              {allowed.length === 0 ? (
                <p className="text-[13px] text-[var(--c-muted)]">Dalsze statusy ustawia administrator.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <select className={INPUT} value={toStatus} onChange={(e) => setToStatus(e.target.value as ProposalStatusKey | "")}>
                    <option value="">Zmień status na…</option>
                    {allowed.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  {toStatus === "DUPLIKAT" && (
                    <select className={INPUT} value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)}>
                      <option value="">Duplikat którego wniosku?</option>
                      {otherOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {proposalNumber(o.number)} — {o.title}
                        </option>
                      ))}
                    </select>
                  )}
                  {toStatus && (
                    <>
                      <textarea rows={2} className={TEXTAREA} placeholder={role === "ADMIN" ? "Decyzja / komentarz (opcjonalnie)" : "Komentarz (opcjonalnie)"} value={statusComment} onChange={(e) => setStatusComment(e.target.value)} />
                      <button type="button" disabled={busy || (toStatus === "DUPLIKAT" && !duplicateOf)} className={BTN_PRIMARY} onClick={() => void changeStatus()}>
                        Zapisz status
                      </button>
                    </>
                  )}
                </div>
              )}
              <ol className="mt-3 flex flex-col gap-1.5 border-t border-[var(--c-border)] pt-3 text-[12.5px]">
                {p.statuses.map((s) => (
                  <li key={s.id}>
                    <span className="text-[var(--c-faint)]">{fmtDateTime(s.at)}</span> · {s.userName ?? "—"}:{" "}
                    {s.from ? `${STATUS_LABEL[s.from]} → ` : ""}
                    <b className="font-semibold">{STATUS_LABEL[s.to]}</b>
                    {s.comment && <span className="block text-[var(--c-muted)]">„{s.comment}”</span>}
                  </li>
                ))}
              </ol>
            </Card>

            <Card title="Szczegóły">
              <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5 text-[13px]">
                <dt className="text-[var(--c-muted)]">Priorytet</dt>
                <dd>
                  {PRIORITY_LABEL[p.priority]}
                  {p.priorityReason && <span className="block text-[var(--c-muted)]">{p.priorityReason}</span>}
                </dd>
                <dt className="text-[var(--c-muted)]">Skala</dt>
                <dd>{p.scale ?? "—"}</dd>
                <dt className="text-[var(--c-muted)]">Przyczyna</dt>
                <dd>{p.causes.length ? p.causes.map((c) => CAUSE_LABEL[c]).join(", ") : "—"}</dd>
                <dt className="text-[var(--c-muted)]">Klienci</dt>
                <dd className="flex flex-col">
                  {p.clients.length
                    ? p.clients.map((c) => (
                        <Link key={c.id} href={`/klienci/${c.id}`} className="text-[var(--c-brand)] hover:underline">
                          {c.name}
                        </Link>
                      ))
                    : "—"}
                </dd>
                <dt className="text-[var(--c-muted)]">Zmieniono</dt>
                <dd>{fmtDateTime(p.updatedAt)}</dd>
                {p.remarks.length > 0 && (
                  <>
                    <dt className="text-[var(--c-muted)]">Z uwagi</dt>
                    <dd>
                      {p.remarks.map((r) => (
                        <Link key={r.id} href="/uwagi" className="block truncate text-[var(--c-brand)] hover:underline">
                          {r.body}
                        </Link>
                      ))}
                    </dd>
                  </>
                )}
              </dl>
            </Card>

            <Card title="Powiązania">
              <ul className="mb-3 flex flex-col gap-1 text-[13px]">
                {p.relations.length === 0 && <li className="text-[var(--c-faint)]">Brak.</li>}
                {p.relations.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="flex-grow">
                      {r.direction === "out" ? RELATION_LABEL[r.kind] : `← ${RELATION_LABEL[r.kind]} (wskazuje ten)`}{" "}
                      <Link href={`/wnioski/${r.otherId}`} className="text-[var(--c-brand)] hover:underline">
                        {proposalNumber(r.otherNumber)}
                      </Link>{" "}
                      <span className="text-[var(--c-muted)]">{r.otherTitle}</span>
                    </span>
                    {r.direction === "out" && role !== "AGENT" && p.canEdit && (
                      <button
                        type="button"
                        className="text-xs text-[var(--c-muted)] hover:text-[var(--c-red)]"
                        onClick={() => void run(`/api/porzadki/wnioski/${p.id}/powiazania?relationId=${r.id}`, "DELETE", undefined)}
                      >
                        usuń
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {p.canEdit && otherOptions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                    <select className={INPUT} value={relKind} onChange={(e) => setRelKind(e.target.value as RelationKey)}>
                      {RELATION_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {RELATION_LABEL[k]}
                        </option>
                      ))}
                    </select>
                    <select className={INPUT} value={relTo} onChange={(e) => setRelTo(e.target.value)}>
                      <option value="">wniosek…</option>
                      {otherOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {proposalNumber(o.number)} — {o.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className={BTN}
                    disabled={busy || !relTo}
                    onClick={async () => (await run(`/api/porzadki/wnioski/${p.id}/powiazania`, "POST", { kind: relKind, toId: relTo })) && setRelTo("")}
                  >
                    Dodaj powiązanie
                  </button>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </PorzadkiLayout>
  );
}
