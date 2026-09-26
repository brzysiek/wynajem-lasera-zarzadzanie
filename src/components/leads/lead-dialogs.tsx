"use client";

import { useEffect, useState } from "react";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import { LOST_REASON_KEYS, LOST_REASON_LABEL, TYPE_LABEL, type LostReasonKey } from "@/lib/leads/labels";
import { LEAD_DEVICE_LABEL, type LeadTypeKey } from "@/lib/leads/parse-deal";
import { DEVICE_INTEREST_KEYS, type DeviceInterestKey } from "@/lib/clients/labels";
import type { ReviewClient } from "@/lib/history/review-load";
import { INPUT, api } from "@/components/clients/client-forms";
import { ClientPicker } from "@/components/clients/history-review";

const LABEL = "flex flex-col gap-1 text-xs font-medium text-[var(--c-muted)]";
export const BTN =
  "h-9 whitespace-nowrap rounded-lg border border-[var(--c-border)] bg-white px-3 text-[13px] text-[var(--c-text)] transition-colors hover:border-[var(--c-brand)] hover:text-[var(--c-brand-deep)] disabled:opacity-40";
export const BTN_PRIMARY =
  "h-9 whitespace-nowrap rounded-lg bg-[var(--c-brand)] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--c-brand-deep)] disabled:opacity-40";

export function Modal({ title, onClose, children, width = 460 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div style={APP_CSS_VARS} data-lead-modal className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Zamknij" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex max-h-[calc(100vh-32px)] w-full flex-col gap-3 overflow-y-auto rounded-2xl bg-white p-6 shadow-[0_12px_40px_rgba(0,0,0,0.2)]" style={{ maxWidth: width }}>
        <h2 className="m-0 text-lg font-semibold text-[var(--c-navy)]">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// Przegrana — powód wymagany (prompt 2, 3.3); opcjonalnie „wróć do kontaktu”
// = zadanie dla prowadzącej osoby w wybranym dniu.
export function LostDialog({
  count = 1,
  onClose,
  onSubmit,
}: {
  count?: number;
  onClose: () => void;
  onSubmit: (v: { lostReason: LostReasonKey; lostNote: string; returnAt: string }) => Promise<string | null>;
}) {
  const [reason, setReason] = useState<LostReasonKey | "">("");
  const [note, setNote] = useState("");
  const [returnAt, setReturnAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasons = LOST_REASON_KEYS.filter((k) => k !== "ARCHIWUM_IMPORTU");

  async function save() {
    if (!reason) return setError("Wybierz powód.");
    setSaving(true);
    const err = await onSubmit({ lostReason: reason, lostNote: note, returnAt });
    setSaving(false);
    if (err) setError(err);
  }

  return (
    <Modal title={count > 1 ? `Przegrana — ${count} sygnałów` : "Przegrana"} onClose={onClose}>
      <div className="flex flex-wrap gap-1.5">
        {reasons.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setReason(k)}
            aria-pressed={reason === k}
            className={`h-8 rounded-full border px-3 text-[13px] transition-colors ${
              reason === k ? "border-[var(--c-red)] bg-[var(--c-red-soft)] font-semibold text-[var(--c-red)]" : "border-[var(--c-border)] hover:border-[var(--c-red)]"
            }`}
          >
            {LOST_REASON_LABEL[k]}
          </button>
        ))}
      </div>
      <label className={LABEL}>
        Notatka <span className="font-normal text-[var(--c-faint)]">(opcjonalnie)</span>
        <textarea rows={2} className={`${INPUT} h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className={LABEL}>
        Wróć do kontaktu <span className="font-normal text-[var(--c-faint)]">(tworzy zadanie na ten dzień)</span>
        <input type="date" className={INPUT} value={returnAt} onChange={(e) => setReturnAt(e.target.value)} />
      </label>
      {error && <p className="text-[13px] text-[var(--c-red)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN} onClick={onClose}>
          Anuluj
        </button>
        <button
          type="button"
          disabled={saving || !reason}
          className="h-9 rounded-lg bg-[var(--c-red)] px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          onClick={() => void save()}
        >
          Oznacz jako przegraną
        </button>
      </div>
    </Modal>
  );
}

const NEW_TYPES: LeadTypeKey[] = ["TELEFON", "EMAIL", "INNE"];

// Nowy sygnał z panelu — np. telefon od klientki. Albo istniejący klient,
// albo dane osoby (klient powstanie automatycznie, jeśli jej nie ma w bazie).
export function NewLeadDialog({ clients, onClose, onCreated }: { clients: ReviewClient[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [type, setType] = useState<LeadTypeKey>("TELEFON");
  const [client, setClient] = useState<ReviewClient | null>(null);
  const [picker, setPicker] = useState(false);
  const [f, setF] = useState({ contactName: "", contactPhone: "", contactEmail: "", requestedFrom: "", requestedDays: "", location: "", message: "" });
  const [devices, setDevices] = useState<DeviceInterestKey[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const { ok, data } = await api<{ id: string }>("/api/leads", "POST", {
      type,
      clientId: client?.id ?? null,
      ...(client ? {} : { contactName: f.contactName, contactPhone: f.contactPhone, contactEmail: f.contactEmail }),
      deviceInterest: devices,
      requestedFrom: f.requestedFrom || null,
      requestedDays: f.requestedDays || null,
      location: f.location,
      message: f.message,
    });
    setSaving(false);
    if (!ok) return setError(data.message ?? "Nie udało się dodać sygnału.");
    onCreated(data.id);
  }

  return (
    <Modal title="Nowy sygnał" onClose={onClose} width={500}>
      <div className="flex gap-1.5">
        {NEW_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={type === t}
            onClick={() => setType(t)}
            className={`h-8 rounded-full border px-3 text-[13px] ${type === t ? "border-[var(--c-brand)] bg-[var(--c-brand-soft)] font-semibold text-[var(--c-brand-deep)]" : "border-[var(--c-border)]"}`}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="relative rounded-[10px] border border-[var(--c-border)] p-3">
        {client ? (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-grow truncate text-sm">
              <b className="font-semibold text-[var(--c-navy)]">{client.name}</b>
              <span className="text-[var(--c-muted)]"> {[client.person, client.city].filter(Boolean).join(" · ")}</span>
            </span>
            <button type="button" className="text-xs text-[var(--c-muted)] hover:text-[var(--c-red)]" onClick={() => setClient(null)}>
              zmień
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--c-muted)]">Kto dzwonił / pisał</span>
              <button type="button" className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]" onClick={() => setPicker(true)}>
                Wybierz istniejącego klienta…
              </button>
            </div>
            <input className={INPUT} placeholder="Imię i nazwisko / gabinet" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className={INPUT} placeholder="Telefon" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} />
              <input className={INPUT} placeholder="E-mail" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} />
            </div>
            <p className="text-[11px] text-[var(--c-faint)]">Jeśli telefonu lub e-maila nie ma w bazie, klient zostanie dodany automatycznie.</p>
          </div>
        )}
        {picker && (
          <ClientPicker
            clients={clients}
            onClose={() => setPicker(false)}
            onPick={(id) => {
              setClient(clients.find((c) => c.id === id) ?? null);
              setPicker(false);
            }}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {DEVICE_INTEREST_KEYS.filter((k) => k !== "SZKOLENIE").map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={devices.includes(k)}
            onClick={() => setDevices((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]))}
            className={`h-7 rounded-full border px-2.5 text-xs ${devices.includes(k) ? "border-[var(--c-brand)] bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]" : "border-[var(--c-border)]"}`}
          >
            {LEAD_DEVICE_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className={LABEL}>
          Termin od
          <input type="date" className={INPUT} value={f.requestedFrom} onChange={(e) => setF({ ...f, requestedFrom: e.target.value })} />
        </label>
        <label className={LABEL}>
          Dni
          <input type="number" min={1} className={INPUT} value={f.requestedDays} onChange={(e) => setF({ ...f, requestedDays: e.target.value })} />
        </label>
        <label className={LABEL}>
          Miejscowość
          <input className={INPUT} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </label>
      </div>
      <label className={LABEL}>
        Czego dotyczy
        <textarea rows={3} className={`${INPUT} h-auto py-2`} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
      </label>
      {error && <p className="text-[13px] text-[var(--c-red)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN} onClick={onClose}>
          Anuluj
        </button>
        <button type="button" disabled={saving} className={BTN_PRIMARY} onClick={() => void save()}>
          Dodaj sygnał
        </button>
      </div>
    </Modal>
  );
}
