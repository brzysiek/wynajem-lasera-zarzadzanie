"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/components/clients/client-forms";
import { ClientPicker } from "@/components/clients/history-review";
import type { ReviewClient } from "@/lib/history/review-load";
import {
  CAUSE_KEYS,
  CAUSE_LABEL,
  PRIORITY_KEYS,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TYPE_KEYS,
  TYPE_LABEL,
  proposalNumber,
  type AreaKey,
  type CauseKey,
  type PriorityKey,
  type ProposalTypeKey,
} from "@/lib/porzadki/labels";
import type { AreaDef } from "@/lib/porzadki/areas";
import { BTN, BTN_GHOST, BTN_PRIMARY, Card, ErrorNote, INPUT, LABEL, TEXTAREA } from "./shared";
import { AreaOptions } from "./area-options";

// Formularz wniosku (nowy / edycja). Przy wpisywaniu tytułu podpowiada
// podobne otwarte wnioski — ochrona przed duplikatami.

export type ProposalFormValue = {
  title: string;
  area: AreaKey | "";
  type: ProposalTypeKey | "";
  problem: string;
  evidence: string;
  scale: string;
  causes: CauseKey[];
  proposal: string;
  priority: PriorityKey;
  priorityReason: string;
  blocksCleanup: boolean;
  clients: { id: string; name: string }[];
};

export const EMPTY_PROPOSAL: ProposalFormValue = {
  title: "",
  area: "",
  type: "",
  problem: "",
  evidence: "",
  scale: "",
  causes: [],
  proposal: "",
  priority: "MEDIUM",
  priorityReason: "",
  blocksCleanup: false,
  clients: [],
};

type Similar = { id: string; number: number; title: string; status: string; score: number };

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`h-7 rounded-full border px-2.5 text-xs transition-colors ${
        on ? "border-[var(--c-brand)] bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]" : "border-[var(--c-border)] text-[var(--c-text)] hover:border-[var(--c-brand)]"
      }`}
    >
      {children}
    </button>
  );
}

export function ProposalForm({
  initial,
  proposalId,
  clientOptions,
  areas,
  onSaved,
  onCancel,
}: {
  initial: ProposalFormValue;
  proposalId?: string; // brak = nowy wniosek
  clientOptions: ReviewClient[];
  areas: AreaDef[];
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<Similar[]>([]);
  const [picking, setPicking] = useState(false);
  const set = <K extends keyof ProposalFormValue>(k: K, v: ProposalFormValue[K]) => setF((p) => ({ ...p, [k]: v }));
  // Skrzynka Tomka: bez przyczyny technicznej i „blokuje porządki”.
  const inbox = areas.find((a) => a.key === f.area)?.dev === false;

  // Podobne otwarte wnioski — po chwili bez pisania.
  useEffect(() => {
    const title = f.title.trim();
    if (title.length < 4) return;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ title, area: f.area, ...(proposalId ? { exclude: proposalId } : {}) });
      void api<{ similar: Similar[] }>(`/api/porzadki/wnioski/similar?${qs}`, "GET").then(({ ok, data }) => ok && setSimilar(data.similar ?? []));
    }, 400);
    return () => clearTimeout(t);
  }, [f.title, f.area, proposalId]);

  async function save(status?: "NOWY" | "DO_DECYZJI") {
    setSaving(true);
    setError(null);
    const body = {
      title: f.title,
      area: f.area,
      type: f.type,
      problem: f.problem,
      evidence: f.evidence,
      scale: f.scale,
      causes: f.causes,
      proposal: f.proposal,
      priority: f.priority,
      priorityReason: f.priorityReason,
      blocksCleanup: f.blocksCleanup,
      clientIds: f.clients.map((c) => c.id),
      ...(status ? { status } : {}),
    };
    const { ok, data } = proposalId
      ? await api(`/api/porzadki/wnioski/${proposalId}`, "PATCH", body)
      : await api<{ id: string }>("/api/porzadki/wnioski", "POST", body);
    setSaving(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać.");
    if (proposalId) onSaved?.();
    else router.push(`/wnioski/${(data as { id: string }).id}`);
  }

  const visibleSimilar = f.title.trim().length >= 4 ? similar : [];

  return (
    <div className="flex flex-col gap-4">
      <Card title="Wniosek">
        <div className="flex flex-col gap-3">
          <label className={LABEL}>
            Tytuł (jedno zdanie)
            <input className={INPUT} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="np. Formularz rezerwacji gubi numer telefonu" />
          </label>
          {visibleSimilar.length > 0 && (
            <div className="rounded-lg border border-[var(--c-gold)] bg-[var(--c-gold-soft)] px-3 py-2 text-[13px]">
              <p className="font-semibold text-[var(--c-gold-deep)]">Podobne otwarte wnioski — sprawdź, czy to nie duplikat:</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {visibleSimilar.map((s) => (
                  <li key={s.id}>
                    <Link href={`/wnioski/${s.id}`} target="_blank" className="text-[var(--c-brand-deep)] hover:underline">
                      {proposalNumber(s.number)} — {s.title}
                    </Link>{" "}
                    <span className="text-xs text-[var(--c-muted)]">({STATUS_LABEL[s.status as keyof typeof STATUS_LABEL] ?? s.status})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              Obszar
              <select className={INPUT} value={f.area} onChange={(e) => set("area", e.target.value as AreaKey | "")}>
                <option value="">— wybierz —</option>
                <AreaOptions areas={areas} />
              </select>
              {inbox && <span className="text-xs font-normal text-[var(--c-muted)]">Skrzynka Tomka — notatka biznesowa, nie zadanie do kodowania.</span>}
            </label>
            <label className={LABEL}>
              Typ
              <select className={INPUT} value={f.type} onChange={(e) => set("type", e.target.value as ProposalTypeKey | "")}>
                <option value="">— wybierz —</option>
                {TYPE_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {TYPE_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={LABEL}>
            Problem — co się dzieje
            <textarea rows={4} className={TEXTAREA} value={f.problem} onChange={(e) => set("problem", e.target.value)} />
          </label>
          <label className={LABEL}>
            Dowód — 2–5 przykładów (ID HubSpot, temat i data maila, nr faktury, link do karty klienta)
            <textarea rows={4} className={TEXTAREA} value={f.evidence} onChange={(e) => set("evidence", e.target.value)} />
          </label>
          <label className={LABEL}>
            Propozycja — co zmienić
            <textarea rows={4} className={TEXTAREA} value={f.proposal} onChange={(e) => set("proposal", e.target.value)} />
          </label>
        </div>
      </Card>

      <Card title="Ocena">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              Skala
              <input className={INPUT} value={f.scale} onChange={(e) => set("scale", e.target.value)} placeholder="np. 224 klientów, codziennie" />
            </label>
            <label className={LABEL}>
              Priorytet
              <select className={INPUT} value={f.priority} onChange={(e) => set("priority", e.target.value as PriorityKey)}>
                {PRIORITY_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {PRIORITY_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={LABEL}>
            Uzasadnienie priorytetu
            <input className={INPUT} value={f.priorityReason} onChange={(e) => set("priorityReason", e.target.value)} />
          </label>
          {!inbox && (
          <fieldset className={LABEL}>
            <legend className="mb-1">Przyczyna (hipoteza)</legend>
            <div className="flex flex-wrap gap-1.5">
              {CAUSE_KEYS.map((k) => (
                <Chip key={k} on={f.causes.includes(k)} onClick={() => set("causes", f.causes.includes(k) ? f.causes.filter((c) => c !== k) : [...f.causes, k])}>
                  {CAUSE_LABEL[k]}
                </Chip>
              ))}
            </div>
          </fieldset>
          )}
          {!inbox && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={f.blocksCleanup} onChange={(e) => set("blocksCleanup", e.target.checked)} />
            Blokuje porządki (bez tej zmiany nie da się dalej porządkować danych)
          </label>
          )}
          <div className={LABEL}>
            Powiązani klienci
            <div className="relative flex flex-wrap items-center gap-1.5">
              {f.clients.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-[var(--c-bg)] py-0.5 pl-2.5 pr-1 text-xs text-[var(--c-text)]">
                  {c.name}
                  <button
                    type="button"
                    aria-label={`Usuń ${c.name}`}
                    onClick={() => set("clients", f.clients.filter((x) => x.id !== c.id))}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[var(--c-muted)] hover:bg-[var(--c-red-soft)] hover:text-[var(--c-red)]"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button type="button" onClick={() => setPicking(true)} className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                + dodaj klienta
              </button>
              {picking && (
                <ClientPicker
                  clients={clientOptions}
                  onClose={() => setPicking(false)}
                  onPick={(id) => {
                    const c = clientOptions.find((x) => x.id === id);
                    if (c && !f.clients.some((x) => x.id === id)) set("clients", [...f.clients, { id: c.id, name: c.name }]);
                    setPicking(false);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </Card>

      <ErrorNote message={error} />
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <button type="button" onClick={onCancel} className={BTN_GHOST}>
            Anuluj
          </button>
        ) : (
          <Link href="/wnioski" className={`${BTN_GHOST} flex items-center`}>
            Anuluj
          </Link>
        )}
        {proposalId ? (
          <button type="button" disabled={saving} onClick={() => void save()} className={BTN_PRIMARY}>
            {saving ? "Zapisywanie…" : "Zapisz zmiany"}
          </button>
        ) : (
          <>
            <button type="button" disabled={saving} onClick={() => void save("NOWY")} className={BTN}>
              Zapisz jako nowy
            </button>
            <button type="button" disabled={saving} onClick={() => void save("DO_DECYZJI")} className={BTN_PRIMARY}>
              {saving ? "Zapisywanie…" : "Zapisz i przekaż do decyzji"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
