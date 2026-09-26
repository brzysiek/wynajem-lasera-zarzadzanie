"use client";

import { useState } from "react";
import { api } from "@/components/clients/client-forms";
import type { CleanupRuleDto } from "@/lib/porzadki/cleanup-rules";
import { BTN, BTN_GHOST, BTN_PRIMARY, ErrorNote, INPUT, PorzadkiLayout, TEXTAREA, fmtDate } from "./shared";

// Reguły porządków — ustalenia, które agent czyta przed pracą. Edytuje ADMIN.

function RuleForm({ initial, onSave, onCancel, busy }: { initial: { body: string; example: string }; onSave: (v: { body: string; example: string }) => void; onCancel: () => void; busy: boolean }) {
  const [v, setV] = useState(initial);
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--c-brand)] bg-white p-3">
      <textarea autoFocus rows={2} className={TEXTAREA} placeholder="Reguła, np. „samo imię nigdy nie wystarcza do dopasowania”" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
      <input className={INPUT} placeholder="Przykład (opcjonalnie), np. Krakow → Kraków" value={v.example} onChange={(e) => setV({ ...v, example: e.target.value })} />
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN_GHOST} onClick={onCancel}>
          Anuluj
        </button>
        <button type="button" className={BTN_PRIMARY} disabled={busy || !v.body.trim()} onClick={() => onSave(v)}>
          Zapisz
        </button>
      </div>
    </div>
  );
}

export function RulesManager({ initial, canEdit }: { initial: CleanupRuleDto[]; canEdit: boolean }) {
  const [rules, setRules] = useState(initial);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const { ok, data } = await api<{ rules: CleanupRuleDto[] }>(path, method, body);
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać.");
    setRules(data.rules);
    setEditing(null);
  }

  return (
    <PorzadkiLayout
      title="Reguły porządków"
      description="Stałe ustalenia dla porządkowania danych. Agent czyta je przed pracą."
      actions={
        canEdit && editing !== "new" ? (
          <button type="button" className={BTN_PRIMARY} onClick={() => setEditing("new")}>
            + Nowa reguła
          </button>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        <ErrorNote message={error} />
        {editing === "new" && <RuleForm busy={busy} initial={{ body: "", example: "" }} onCancel={() => setEditing(null)} onSave={(v) => void run("/api/porzadki/reguly", "POST", v)} />}
        {rules.length === 0 && editing !== "new" && (
          <p className="rounded-xl border border-[var(--c-border)] bg-white px-6 py-10 text-center text-sm text-[var(--c-muted)]">Nie ma jeszcze reguł.</p>
        )}
        <ol className="flex flex-col gap-2">
          {rules.map((r, i) =>
            editing === r.id ? (
              <li key={r.id}>
                <RuleForm busy={busy} initial={{ body: r.body, example: r.example ?? "" }} onCancel={() => setEditing(null)} onSave={(v) => void run(`/api/porzadki/reguly/${r.id}`, "PATCH", v)} />
              </li>
            ) : (
              <li key={r.id} className="flex items-start gap-3 rounded-xl border border-[var(--c-border)] bg-white px-4 py-3">
                <span className="mt-0.5 w-6 flex-none text-sm font-semibold tabular-nums text-[var(--c-faint)]">{i + 1}.</span>
                <div className="min-w-0 flex-grow">
                  <p className="whitespace-pre-wrap text-[14px] text-[var(--c-navy)]">{r.body}</p>
                  {r.example && <p className="mt-0.5 text-[13px] text-[var(--c-sidebar-text)]">Przykład: {r.example}</p>}
                  <p className="mt-1 text-xs text-[var(--c-faint)]">
                    {r.createdBy ?? "—"} · {fmtDate(r.createdAt)}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex flex-none gap-2">
                    <button type="button" className={`${BTN} h-8 text-[13px]`} onClick={() => setEditing(r.id)}>
                      Edytuj
                    </button>
                    <button
                      type="button"
                      className={`${BTN_GHOST} h-8 text-[13px] hover:text-[var(--c-red)]`}
                      onClick={() => window.confirm("Usunąć tę regułę?") && void run(`/api/porzadki/reguly/${r.id}`, "DELETE")}
                    >
                      Usuń
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ol>
      </div>
    </PorzadkiLayout>
  );
}
