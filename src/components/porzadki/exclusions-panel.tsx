"use client";

import { useState } from "react";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import { api } from "@/components/clients/client-forms";
import { BTN_GHOST, BTN_PRIMARY, Card, ErrorNote, INPUT, LABEL, TEXTAREA } from "./shared";

// Ustawienia → Wykluczenia maili (wniosek 7): dodawanie hurtem (lista od
// agenta), zdejmowanie pozycji i słowa kluczowe dla domen „ukrywaj”.

type Row = { id: string; kind: "EXCLUDE" | "HIDE"; value: string; note: string | null; createdAt: string };
type Applied = { hidden: number; shown: number };

export function ExclusionsPanel({ initialRows, initialKeywords }: { initialRows: Row[]; initialKeywords: string[] }) {
  const [rows, setRows] = useState(initialRows);
  const [values, setValues] = useState("");
  const [kind, setKind] = useState<"EXCLUDE" | "HIDE">("EXCLUDE");
  const [note, setNote] = useState("");
  const [keywords, setKeywords] = useState(initialKeywords.join(", "));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const appliedText = (a: Applied) => `Ukryto ${a.hidden} i przywrócono ${a.shown} zapisanych maili.`;

  async function add() {
    setBusy(true);
    setError(null);
    const { ok, data } = await api<{ rows: Row[]; values: string[]; errors: string[]; applied: Applied }>("/api/porzadki/wykluczenia", "POST", { values, kind, note });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się dodać.");
    setRows(data.rows);
    setValues("");
    setNote("");
    setInfo(`Dodano ${data.values.length}. ${appliedText(data.applied)}${data.errors.length ? ` Pominięto: ${data.errors.join(" ")}` : ""}`);
  }
  async function remove(r: Row) {
    if (!window.confirm(`Zdjąć „${r.value}” z listy? Ukryte przez nią maile wrócą do historii.`)) return;
    const { ok, data } = await api<{ rows: Row[]; applied: Applied }>(`/api/porzadki/wykluczenia/${r.id}`, "DELETE");
    if (!ok) return setError(data.message ?? "Nie udało się usunąć.");
    setRows(data.rows);
    setInfo(appliedText(data.applied));
  }
  async function saveKeywords() {
    setBusy(true);
    const { ok, data } = await api<{ applied: Applied }>("/api/porzadki/wykluczenia", "POST", { keywords });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać.");
    setInfo(`Zapisano słowa. ${appliedText(data.applied)}`);
  }

  const shown = rows.filter((r) => !q.trim() || r.value.includes(q.trim().toLowerCase()));
  const group = (k: Row["kind"]) => shown.filter((r) => r.kind === k);

  return (
    <div style={APP_CSS_VARS} className="flex flex-col gap-5 text-[var(--c-text)]">
      <Card title="Dodaj">
        <div className="flex flex-col gap-3">
          <label className={LABEL}>
            Domeny lub adresy (każda w osobnej linii albo po przecinku)
            <textarea rows={5} className={TEXTAREA} value={values} onChange={(e) => setValues(e.target.value)} placeholder={"edina.pl\nrightspace.pl\njan.kowalski@gmail.com"} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              Rodzaj
              <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as "EXCLUDE" | "HIDE")}>
                <option value="EXCLUDE">wyklucz — maile i kontakty nie trafiają do panelu</option>
                <option value="HIDE">ukrywaj w historii — chyba że wątek dotyczy wynajmu</option>
              </select>
            </label>
            <label className={LABEL}>
              Dopisek (opcjonalnie)
              <input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} placeholder="np. firmy inżynieryjne (wniosek 7)" />
            </label>
          </div>
          <div className="flex justify-end">
            <button type="button" className={BTN_PRIMARY} disabled={busy || !values.trim()} onClick={() => void add()}>
              {busy ? "Zapisywanie…" : "Dodaj do listy"}
            </button>
          </div>
        </div>
      </Card>
      {error && <ErrorNote message={error} />}
      {info && <p className="rounded-lg bg-[var(--c-green-soft)] px-3 py-2 text-[13px] text-[var(--c-green-deep)]">{info}</p>}

      <Card title={`Na liście (${rows.length})`} action={
          <input
            className="h-9 w-56 rounded-lg border border-[var(--c-border)] bg-white px-3 text-sm outline-none focus:border-[var(--c-brand)]"
            placeholder="Szukaj domeny…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }>
        {(["EXCLUDE", "HIDE"] as const).map((k) => (
          <div key={k} className="mb-4 last:mb-0">
            <h3 className="mb-2 text-[14px] font-semibold text-[var(--c-navy)]">
              {k === "EXCLUDE" ? "Wykluczone" : "Ukrywane w historii"} ({group(k).length})
            </h3>
            {group(k).length === 0 ? (
              <p className="text-[13px] text-[var(--c-muted)]">Brak.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {group(k).map((r) => (
                  <li key={r.id} className="flex items-center gap-1.5 rounded bg-[var(--c-divider)] py-0.5 pl-2 pr-1 font-mono text-[12px]" title={r.note ?? undefined}>
                    {r.value}
                    <button type="button" onClick={() => void remove(r)} className="rounded px-1 text-[var(--c-muted)] hover:bg-white hover:text-[var(--c-red)]" aria-label={`Usuń ${r.value}`}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </Card>

      <Card title="Słowa, które pokazują wątki z domen „ukrywaj”">
        <p className="mb-2 text-[13px] text-[var(--c-muted)]">Jeśli temat albo skrót wiadomości zawiera któreś słowo (fragment, bez względu na wielkość liter i polskie znaki), wątek zostaje widoczny w historii klienta.</p>
        <textarea rows={3} className={TEXTAREA} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={BTN_GHOST} onClick={() => setKeywords(initialKeywords.join(", "))}>
            Cofnij
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void saveKeywords()}>
            Zapisz słowa
          </button>
        </div>
      </Card>
    </div>
  );
}
