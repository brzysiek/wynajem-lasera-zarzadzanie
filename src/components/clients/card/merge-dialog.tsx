"use client";

import { useContext, useState } from "react";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import type { ClientDetail } from "@/lib/clients/load";
import type { ReviewClient } from "@/lib/history/review-load";
import { AgentModeContext, api } from "../client-forms";
import { ClientPicker } from "../history-review";

// „Scal duplikat” — wskazany klient (duplikat) przechodzi w tego: osoby,
// wynajmy, historia, faktury, sygnały, notatki, e-maile; puste pola się
// uzupełniają, a duplikat trafia do archiwum („duplikat”). Agent: źródło i
// pewność wymagane (dziennik zmian).

const INPUT =
  "h-9 w-full rounded-lg border border-[var(--c-border)] bg-white px-3 text-sm outline-none focus:border-[var(--c-brand)] placeholder:text-[var(--c-faint)]";

export function MergeDialog({ target, clients, onClose, onMerged }: { target: ClientDetail; clients: ReviewClient[]; onClose: () => void; onMerged: (next: ClientDetail) => void }) {
  const agent = useContext(AgentModeContext);
  const [source, setSource] = useState<ReviewClient | null>(null);
  const [picking, setPicking] = useState(false);
  const [prov, setProv] = useState({ changeSource: "", changeConfidence: "", changeBatch: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge() {
    if (!source) return;
    if (!window.confirm(`Scalić „${source.name}” w „${target.name}”? Wszystko z „${source.name}” przejdzie tutaj, a „${source.name}” trafi do archiwum jako duplikat.`)) return;
    setBusy(true);
    setError(null);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${target.id}/merge`, "POST", { sourceId: source.id, ...prov });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się scalić.");
    onMerged(data.detail);
  }

  return (
    <div style={APP_CSS_VARS} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 text-[var(--c-text)] shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Scal duplikat">
        <h2 className="m-0 text-[17px] font-semibold text-[var(--c-navy)]">Scal duplikat w „{target.name}”</h2>
        <p className="mt-1 text-[13px] text-[var(--c-muted)]">
          Wybierz klienta, który jest duplikatem. Jego osoby, wynajmy, historia, faktury, sygnały, notatki i e-maile przejdą tutaj, puste pola się uzupełnią, a on sam trafi do archiwum. W HubSpocie nic się nie zmieni.
        </p>
        <div className="relative mt-4">
          {source ? (
            <p className="text-[14px]">
              Duplikat: <b className="font-semibold">{source.name}</b>
              {source.city && <span className="text-[var(--c-muted)]"> · {source.city}</span>}{" "}
              <button type="button" className="ml-1 text-xs text-[var(--c-brand)]" onClick={() => setPicking(true)}>
                zmień
              </button>
            </p>
          ) : (
            <button type="button" className="text-sm font-semibold text-[var(--c-brand)]" onClick={() => setPicking(true)}>
              Wybierz duplikat…
            </button>
          )}
          {picking && (
            <ClientPicker
              clients={clients.filter((c) => c.id !== target.id)}
              onClose={() => setPicking(false)}
              onPick={(id) => {
                setSource(clients.find((c) => c.id === id) ?? null);
                setPicking(false);
              }}
            />
          )}
        </div>
        {agent && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-dashed border-[var(--c-brand)] bg-[var(--c-brand-soft)] p-2.5">
            <input className={INPUT} placeholder="Źródło (dlaczego to ten sam klient)" value={prov.changeSource} onChange={(e) => setProv({ ...prov, changeSource: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select className={INPUT} value={prov.changeConfidence} onChange={(e) => setProv({ ...prov, changeConfidence: e.target.value })}>
                <option value="">Pewność…</option>
                <option value="HIGH">wysoka</option>
                <option value="MEDIUM">średnia</option>
                <option value="LOW">niska</option>
              </select>
              <input className={INPUT} placeholder="Paczka (opcjonalnie)" value={prov.changeBatch} onChange={(e) => setProv({ ...prov, changeBatch: e.target.value })} />
            </div>
          </div>
        )}
        {error && <p className="mt-3 rounded-lg bg-[var(--c-red-soft)] px-3 py-2 text-[13px] text-[var(--c-red)]">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="h-9 rounded-lg px-3 text-sm text-[var(--c-muted)] hover:bg-[var(--c-bg)]" onClick={onClose}>
            Anuluj
          </button>
          <button
            type="button"
            className="h-9 rounded-lg bg-[var(--c-brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--c-brand-deep)] disabled:opacity-50"
            disabled={busy || !source}
            onClick={() => void merge()}
          >
            {busy ? "Scalanie…" : "Scal"}
          </button>
        </div>
      </div>
    </div>
  );
}
