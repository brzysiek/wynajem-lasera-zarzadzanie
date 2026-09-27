"use client";

import { useContext, useState } from "react";
import type { ClientDetail } from "@/lib/clients/load";
import { AgentModeContext, EMPTY_PROVENANCE, FormError, INPUT, ProvenanceFields, api, type Provenance } from "../client-forms";
import { BTN_OUTLINE, BTN_PRIMARY } from "./kit";

// Edycja pól sekcji karty w miejscu (sekcja 3): pola proste i zagnieżdżone
// („deliveryNotes.entrance”). Zapis: PATCH /api/clients/:id — walidacja,
// dziennik zmian i pochodzenie pól po stronie serwera. Agent podaje źródło.

export type FieldDef = {
  key: string; // „regon” albo „deliveryNotes.power”
  label: string;
  kind?: "text" | "textarea" | "date" | "list" | "bool" | "select" | "number";
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
};

type Values = Record<string, string>;

function toBody(fields: FieldDef[], v: Values, initial: Values): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const nested: Record<string, Record<string, unknown>> = {};
  const touchedParents = new Set<string>();
  for (const f of fields) {
    const raw = v[f.key] ?? "";
    const value: unknown = f.kind === "bool" ? (raw === "" ? null : raw === "tak") : f.kind === "list" ? (raw.trim() ? raw.split(/\n|;/).map((x) => x.trim()).filter(Boolean) : null) : raw.trim() === "" ? null : raw.trim();
    const [parent, child] = f.key.split(".");
    if (child) {
      nested[parent] = { ...(nested[parent] ?? {}), [child]: value };
      if (raw !== (initial[f.key] ?? "")) touchedParents.add(parent);
    } else if (raw !== (initial[f.key] ?? "")) body[f.key] = value;
  }
  for (const p of touchedParents) {
    const obj = nested[p];
    body[p] = Object.values(obj).some((x) => x !== null && x !== "") ? obj : null;
  }
  return body;
}

export function FieldsEditor({
  clientId,
  fields,
  initial,
  onSaved,
  onCancel,
  extraBody,
}: {
  clientId: string;
  fields: FieldDef[];
  initial: Values;
  onSaved: (next: ClientDetail) => void;
  onCancel: () => void;
  extraBody?: (v: Values) => Record<string, unknown>;
}) {
  const [v, setV] = useState<Values>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agent = useContext(AgentModeContext);
  const [prov, setProv] = useState<Provenance>(EMPTY_PROVENANCE);

  async function save() {
    const body = { ...toBody(fields, v, initial), ...(extraBody?.(v) ?? {}) };
    if (!Object.keys(body).length) return onCancel();
    setSaving(true);
    setError(null);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${clientId}`, "PATCH", { ...body, ...(agent ? prov : {}) });
    setSaving(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać.");
    onSaved(data.detail);
  }

  return (
    <div className="flex flex-col gap-2.5 border-t border-[var(--c-divider)] pt-3">
      {fields.map((f) => (
        <label key={f.key} className="grid grid-cols-[130px_minmax(0,1fr)] items-start gap-2.5 text-[14px] text-[var(--c-muted)]">
          <span className="pt-2">{f.label}</span>
          <span className="flex flex-col gap-1">
            {f.kind === "textarea" || f.kind === "list" ? (
              <textarea
                rows={f.kind === "list" ? 3 : 2}
                className="w-full resize-y border border-[var(--c-border)] px-3 py-2 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-brand)]"
                value={v[f.key] ?? ""}
                placeholder={f.placeholder ?? (f.kind === "list" ? "każda pozycja w osobnej linii" : undefined)}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              />
            ) : f.kind === "bool" || f.kind === "select" ? (
              <select className={INPUT} value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}>
                <option value="">—</option>
                {(f.options ?? [
                  { value: "tak", label: "tak" },
                  { value: "nie", label: "nie" },
                ]).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={INPUT}
                type={f.kind === "date" ? "date" : "text"}
                inputMode={f.kind === "number" ? "decimal" : undefined}
                value={v[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              />
            )}
            {f.hint && <span className="text-[14px] text-[var(--c-faint)]">{f.hint}</span>}
          </span>
        </label>
      ))}
      {agent && <ProvenanceFields value={prov} onChange={setProv} />}
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={BTN_OUTLINE}>
          Anuluj
        </button>
        <button type="button" onClick={() => void save()} disabled={saving} className={BTN_PRIMARY}>
          {saving ? "Zapisywanie…" : "Zapisz"}
        </button>
      </div>
    </div>
  );
}

export const dateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
export const boolInput = (b: boolean | null | undefined) => (b == null ? "" : b ? "tak" : "nie");
