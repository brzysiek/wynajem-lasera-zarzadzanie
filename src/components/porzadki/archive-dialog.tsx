"use client";

import { useState } from "react";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import { api } from "@/components/clients/client-forms";
import { ARCHIVE_REASON_KEYS, ARCHIVE_REASON_LABEL, type ArchiveReasonKey } from "@/lib/porzadki/labels";
import { BTN_GHOST, BTN_PRIMARY, ErrorNote, INPUT, LABEL, TEXTAREA } from "./shared";

// Archiwizacja klienta / kontaktu z zapytania / sygnału — tylko ADMIN.
// Wymagane: powód i dopisek (uzasadnienie, dowód); paczka opcjonalnie.

export function ArchiveDialog({
  type,
  ids,
  label,
  onClose,
  onDone,
}: {
  type: "client" | "lead";
  ids: string[];
  label: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<ArchiveReasonKey | "">("");
  const [note, setNote] = useState("");
  const [batch, setBatch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Po archiwizacji „spoza branży”: domeny osób do listy wykluczeń (wniosek 7).
  const [domains, setDomains] = useState<{ value: string; on: boolean }[] | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { ok, data } = await api<{ suggestedDomains?: string[] }>("/api/porzadki/archiwum", "POST", { type, ids, reason, note, batch });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się zarchiwizować.");
    if (data.suggestedDomains?.length) return setDomains(data.suggestedDomains.map((value) => ({ value, on: true })));
    onDone();
  }

  async function exclude() {
    const values = (domains ?? []).filter((d) => d.on).map((d) => d.value);
    if (!values.length) return onDone();
    setBusy(true);
    const { ok, data } = await api("/api/porzadki/wykluczenia", "POST", { values: values.join("\n"), kind: "EXCLUDE", note: `archiwizacja „${label}” (spoza branży)` });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się dodać do wykluczeń.");
    onDone();
  }

  if (domains) {
    return (
      <div style={APP_CSS_VARS} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onDone}>
        <div className="w-full max-w-md rounded-xl bg-white p-5 text-[var(--c-text)] shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Lista wykluczeń">
          <h2 className="m-0 text-[17px] font-semibold text-[var(--c-navy)]">Dodać domeny do listy wykluczeń?</h2>
          <p className="mt-1 text-[13px] text-[var(--c-muted)]">
            Zarchiwizowano. Żeby „{label}” nie wrócił z Gmaila ani HubSpota, dodaj domeny jego osób do wykluczeń — maile z nich nie trafią do panelu, a kontakty nie utworzą klientów.
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {domains.map((d, i) => (
              <label key={d.value} className="flex items-center gap-2 text-[14px]">
                <input type="checkbox" checked={d.on} onChange={(e) => setDomains(domains.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                <span className="font-mono">{d.value}</span>
              </label>
            ))}
          </div>
          <ErrorNote message={error} />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={BTN_GHOST} onClick={onDone}>
              Nie teraz
            </button>
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void exclude()}>
              Dodaj do wykluczeń
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={APP_CSS_VARS} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 text-[var(--c-text)] shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Archiwizacja">
        <h2 className="m-0 text-[17px] font-semibold text-[var(--c-navy)]">Do archiwum: {label}</h2>
        <p className="mt-1 text-[13px] text-[var(--c-muted)]">
          {type === "client"
            ? "Klient zniknie z list, sygnałów, „Do obdzwonienia”, wyszukiwania i dopasowań — razem ze swoimi sygnałami. W HubSpocie nic się nie zmieni. Można go przywrócić."
            : "Sygnał zniknie z list i „Do obdzwonienia”. W HubSpocie nic się nie zmieni. Można go przywrócić."}
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <label className={LABEL}>
            Powód
            <select className={INPUT} value={reason} onChange={(e) => setReason(e.target.value as ArchiveReasonKey | "")}>
              <option value="">— wybierz —</option>
              {ARCHIVE_REASON_KEYS.map((k) => (
                <option key={k} value={k}>
                  {ARCHIVE_REASON_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Dopisek — uzasadnienie i dowód
            <textarea rows={3} className={TEXTAREA} value={note} onChange={(e) => setNote(e.target.value)} placeholder="np. firma z branży budowlanej, zapytanie przez pomyłkę (mail 14.03)" />
          </label>
          <label className={LABEL}>
            Paczka (opcjonalnie)
            <input className={INPUT} value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="np. P-2026-09-27-01" />
          </label>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN_GHOST} onClick={onClose}>
              Anuluj
            </button>
            <button type="button" className={BTN_PRIMARY} disabled={busy || !reason || !note.trim()} onClick={() => void save()}>
              {busy ? "Archiwizowanie…" : "Do archiwum"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
