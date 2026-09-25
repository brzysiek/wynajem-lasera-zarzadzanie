"use client";

import { useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import {
  CLINIC_TYPE_LABEL,
  DEVICE_INTEREST_KEYS,
  DEVICE_INTEREST_LABEL,
  SOURCE_LABEL,
  type ClinicTypeKey,
  type DeviceInterestKey,
  type SourceKey,
} from "@/lib/clients/labels";
import type { ClientContactDto, ClientDetail } from "@/lib/clients/load";
import { applySmsPlaceholders } from "@/lib/sms-template";

// Formularze modułu Klienci: dane klienta, osoba kontaktowa, notatka, SMS i
// nowy klient. Walidację robi serwer (src/lib/clients/validate.ts) —
// formularze pokazują jego komunikat, nie dublują reguł.

export async function api<T = unknown>(path: string, method: string, body?: unknown): Promise<{ ok: boolean; data: T & { message?: string } }> {
  const res = await fetch(`${BASE_PATH}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export const INPUT =
  "h-9 w-full rounded-lg border border-[var(--c-border)] bg-white px-3 text-sm text-[var(--c-text)] outline-none transition-colors focus:border-[var(--c-brand)] placeholder:text-[var(--c-faint)]";
const LABEL = "flex flex-col gap-1 text-xs font-medium text-[var(--c-muted)]";
export const BTN_PRIMARY =
  "h-9 rounded-lg bg-[var(--c-brand)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--c-brand-deep)] disabled:opacity-50";
export const BTN_GHOST =
  "h-9 rounded-lg px-3 text-sm font-medium text-[var(--c-muted)] transition-colors hover:bg-[var(--c-bg)] hover:text-[var(--c-text)]";

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-lg bg-[var(--c-red-soft)] px-3 py-2 text-[13px] text-[var(--c-red)]">{message}</p>;
}

// ------------------------------------------------------------------ dane klienta

export function ClientDataForm({
  detail,
  onSaved,
  onCancel,
}: {
  detail: ClientDetail;
  onSaved: (next: ClientDetail, refreshedRentals: number) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    name: detail.name,
    nip: detail.nip ?? "",
    street: detail.street ?? "",
    zip: detail.zip ?? "",
    city: detail.city ?? "",
    country: detail.country ?? "",
    transportPriceNet: detail.transportPriceNet ? String(Number(detail.transportPriceNet)) : "",
    distanceKm: detail.distanceKm ? String(Number(detail.distanceKm)) : "",
    clinicType: (detail.clinicType ?? "") as ClinicTypeKey | "",
    source: (detail.source ?? "") as SourceKey | "",
    deviceInterests: detail.deviceInterests,
    blocked: detail.statusOverride === "NIE_KONTAKTOWAC",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setSaving(true);
    setError(null);
    const { ok, data } = await api<{ detail: ClientDetail; refreshedRentals: number }>(`/api/clients/${detail.id}`, "PATCH", {
      name: f.name,
      nip: f.nip,
      street: f.street,
      zip: f.zip,
      city: f.city,
      country: f.country,
      transportPriceNet: f.transportPriceNet,
      distanceKm: f.distanceKm,
      clinicType: f.clinicType || null,
      source: f.source || null,
      deviceInterests: f.deviceInterests,
      statusOverride: f.blocked ? "NIE_KONTAKTOWAC" : null,
    });
    setSaving(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać.");
    onSaved(data.detail, data.refreshedRentals);
  }

  return (
    <div className="flex flex-col gap-3">
      <label className={LABEL}>
        Nazwa gabinetu
        <input className={INPUT} value={f.name} onChange={(e) => set("name", e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <label className={LABEL}>
          NIP
          <input className={INPUT} value={f.nip} onChange={(e) => set("nip", e.target.value)} placeholder="679-000-11-22" />
        </label>
        <label className={LABEL}>
          Kraj
          <input className={INPUT} value={f.country} onChange={(e) => set("country", e.target.value)} />
        </label>
      </div>
      <label className={LABEL}>
        Ulica i numer
        <input className={INPUT} value={f.street} onChange={(e) => set("street", e.target.value)} />
      </label>
      <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2.5">
        <label className={LABEL}>
          Kod
          <input className={INPUT} value={f.zip} onChange={(e) => set("zip", e.target.value)} placeholder="30-001" />
        </label>
        <label className={LABEL}>
          Miasto
          <input className={INPUT} value={f.city} onChange={(e) => set("city", e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <label className={LABEL}>
          Transport netto (zł)
          <input className={INPUT} inputMode="decimal" value={f.transportPriceNet} onChange={(e) => set("transportPriceNet", e.target.value)} />
        </label>
        <label className={LABEL}>
          Odległość (km)
          <input className={INPUT} inputMode="decimal" value={f.distanceKm} onChange={(e) => set("distanceKm", e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <label className={LABEL}>
          Rodzaj gabinetu
          <select className={INPUT} value={f.clinicType} onChange={(e) => set("clinicType", e.target.value as ClinicTypeKey | "")}>
            <option value="">—</option>
            {(Object.keys(CLINIC_TYPE_LABEL) as ClinicTypeKey[]).map((k) => (
              <option key={k} value={k}>
                {CLINIC_TYPE_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Źródło
          <select className={INPUT} value={f.source} onChange={(e) => set("source", e.target.value as SourceKey | "")}>
            <option value="">—</option>
            {(Object.keys(SOURCE_LABEL) as SourceKey[]).map((k) => (
              <option key={k} value={k}>
                {SOURCE_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className={LABEL}>
        <legend className="mb-1">Zainteresowanie urządzeniami</legend>
        <div className="flex flex-wrap gap-1.5">
          {DEVICE_INTEREST_KEYS.map((k: DeviceInterestKey) => {
            const on = f.deviceInterests.includes(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => set("deviceInterests", on ? f.deviceInterests.filter((d) => d !== k) : [...f.deviceInterests, k])}
                className={`h-7 rounded-full border px-2.5 text-xs transition-colors ${
                  on
                    ? "border-[var(--c-brand)] bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]"
                    : "border-[var(--c-border)] text-[var(--c-text)] hover:border-[var(--c-brand)]"
                }`}
              >
                {DEVICE_INTEREST_LABEL[k]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="flex items-start gap-2 rounded-lg border border-[var(--c-border)] px-3 py-2 text-[13px]">
        <input type="checkbox" className="mt-0.5" checked={f.blocked} onChange={(e) => set("blocked", e.target.checked)} />
        <span>
          <b className="font-semibold">Nie kontaktować</b>
          <span className="block text-xs text-[var(--c-muted)]">Nie chcemy albo nie możemy współpracować — status klienta zostanie przekreślony.</span>
        </span>
      </label>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={BTN_GHOST}>
          Anuluj
        </button>
        <button type="button" onClick={() => void save()} disabled={saving} className={BTN_PRIMARY}>
          {saving ? "Zapisywanie…" : "Zapisz"}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ osoba kontaktowa

export function ContactForm({
  clientId,
  contact,
  onSaved,
  onCancel,
}: {
  clientId: string;
  contact: ClientContactDto | null; // null = nowa osoba
  onSaved: (next: ClientDetail, refreshedRentals: number) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
    role: contact?.role ?? "",
    isPrimary: contact?.isPrimary ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const body = { ...f, isPrimary: f.isPrimary || undefined };
    const { ok, data } = contact
      ? await api<{ detail: ClientDetail; refreshedRentals: number }>(`/api/clients/${clientId}/contacts/${contact.id}`, "PATCH", body)
      : await api<{ detail: ClientDetail; refreshedRentals: number }>(`/api/clients/${clientId}/contacts`, "POST", body);
    setSaving(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać.");
    onSaved(data.detail, data.refreshedRentals ?? 0);
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-[var(--c-brand)] bg-white p-3">
      <div className="grid grid-cols-2 gap-2">
        <input className={INPUT} placeholder="Imię" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
        <input className={INPUT} placeholder="Nazwisko" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
      </div>
      <input className={INPUT} placeholder="Telefon, np. 601 000 111" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      <input className={INPUT} placeholder="E-mail" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <input className={INPUT} placeholder="Rola, np. właścicielka, kosmetolog" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} />
      {!contact?.isPrimary && (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} />
          Osoba główna (do niej trafiają dane na wynajmach)
        </label>
      )}
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={BTN_GHOST}>
          Anuluj
        </button>
        <button type="button" onClick={() => void save()} disabled={saving} className={BTN_PRIMARY}>
          {saving ? "Zapisywanie…" : contact ? "Zapisz" : "Dodaj osobę"}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ notatka

export function NoteEditor({
  clientId,
  notes,
  onSaved,
  onCancel,
}: {
  clientId: string;
  notes: string | null;
  onSaved: (next: ClientDetail) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${clientId}`, "PATCH", { notes: value });
    setSaving(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać notatki.");
    onSaved(data.detail);
  }

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--c-brand)] bg-white p-3">
      <textarea
        autoFocus
        rows={4}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Notatka wewnętrzna — np. preferencje, ustalenia, na co uważać."
        className="w-full resize-y rounded-lg border border-[var(--c-border)] px-3 py-2 text-sm outline-none focus:border-[var(--c-brand)]"
      />
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={BTN_GHOST}>
          Anuluj
        </button>
        <button type="button" onClick={() => void save()} disabled={saving} className={BTN_PRIMARY}>
          {saving ? "Zapisywanie…" : "Zapisz notatkę"}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ SMS

type Template = { id: string; label: string; body: string };

// Istniejące szablony SMS (/ustawienia/szablony-sms) i istniejąca wysyłka
// (POST /api/sms/send) — bez nowego mechanizmu. Zmienne rezerwacji zostają
// widoczne jako {tekst}, bo poza wynajmem nie ma ich czym wypełnić.
export function SmsComposer({
  recipients,
  clientName,
  onSent,
  onCancel,
}: {
  recipients: { label: string; phone: string }[];
  clientName: string;
  onSent: () => void;
  onCancel: () => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [phone, setPhone] = useState(recipients[0]?.phone ?? "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api<{ templates: Template[] }>("/api/message-templates", "GET").then(({ ok, data }) => {
      if (alive && ok) setTemplates(data.templates ?? []);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function send() {
    setSending(true);
    setError(null);
    const { ok, data } = await api("/api/sms/send", "POST", { phone, message });
    setSending(false);
    if (!ok) return setError(data.message ?? "Nie udało się wysłać SMS-a.");
    onSent();
  }

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--c-brand)] bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[var(--c-navy)]">SMS do klienta</span>
        {recipients.length > 1 && (
          <select className="h-7 rounded-md border border-[var(--c-border)] px-2 text-xs" value={phone} onChange={(e) => setPhone(e.target.value)}>
            {recipients.map((r) => (
              <option key={r.phone} value={r.phone}>
                {r.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {templates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setMessage(applySmsPlaceholders(t.body, { clientName }))}
              className="h-7 rounded-full border border-[var(--c-border)] px-2.5 text-xs transition-colors hover:border-[var(--c-brand)] hover:text-[var(--c-brand-deep)]"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <textarea
        autoFocus
        rows={4}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Treść SMS-a albo wybierz szablon powyżej"
        className="w-full resize-y rounded-lg border border-[var(--c-border)] px-3 py-2 text-sm outline-none focus:border-[var(--c-brand)]"
      />
      <div className="flex items-center justify-between text-xs text-[var(--c-muted)]">
        <span>do {recipients.find((r) => r.phone === phone)?.label ?? phone}</span>
        <span className="tabular-nums">{message.length} zn.</span>
      </div>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={BTN_GHOST}>
          Anuluj
        </button>
        <button type="button" onClick={() => void send()} disabled={sending || !message.trim() || !phone} className={BTN_PRIMARY}>
          {sending ? "Wysyłanie…" : "Wyślij SMS"}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ nowy klient

export function NewClientDialog({
  onClose,
  onCreated,
  initialName = "",
  hint,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  initialName?: string;
  hint?: string;
}) {
  const [f, setF] = useState({ name: initialName, firstName: "", lastName: "", phone: "", email: "", street: "", zip: "", city: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    setError(null);
    const person = [f.firstName, f.lastName].filter((x) => x.trim()).join(" ");
    const { ok, data } = await api<{ id: string }>("/api/clients", "POST", {
      // Klientka bez gabinetu — klient jednoosobowy, nazwą jest ona sama.
      client: { name: f.name.trim() || person || f.email, street: f.street, zip: f.zip, city: f.city },
      contact: { firstName: f.firstName, lastName: f.lastName, phone: f.phone, email: f.email },
    });
    setSaving(false);
    if (!ok) return setError(data.message ?? "Nie udało się dodać klienta.");
    onCreated(data.id);
  }

  return (
    <div style={APP_CSS_VARS} className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Nowy klient">
      <button type="button" aria-label="Zamknij" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex w-full max-w-[460px] flex-col gap-3 rounded-2xl bg-white p-6 shadow-[0_12px_40px_rgba(0,0,0,0.2)]">
        <div>
          <h2 className="m-0 text-lg font-semibold text-[var(--c-navy)]">Nowy klient</h2>
          <p className="text-xs text-[var(--c-muted)]">{hint ?? "Minimum na start — resztę uzupełnisz na karcie klienta."}</p>
        </div>
        <label className={LABEL}>
          Nazwa gabinetu <span className="font-normal text-[var(--c-faint)]">(puste = klientka prywatna)</span>
          <input autoFocus className={INPUT} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="np. Gabinet Aurora" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className={LABEL}>
            Imię
            <input className={INPUT} value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
          </label>
          <label className={LABEL}>
            Nazwisko
            <input className={INPUT} value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className={LABEL}>
            Telefon
            <input className={INPUT} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="601 000 111" />
          </label>
          <label className={LABEL}>
            E-mail
            <input className={INPUT} inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </label>
        </div>
        <label className={LABEL}>
          Ulica i numer
          <input className={INPUT} value={f.street} onChange={(e) => setF({ ...f, street: e.target.value })} />
        </label>
        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
          <label className={LABEL}>
            Kod
            <input className={INPUT} value={f.zip} onChange={(e) => setF({ ...f, zip: e.target.value })} />
          </label>
          <label className={LABEL}>
            Miasto
            <input className={INPUT} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </label>
        </div>
        <FormError message={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Anuluj
          </button>
          <button type="button" onClick={() => void save()} disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Dodawanie…" : "Dodaj klienta"}
          </button>
        </div>
      </div>
    </div>
  );
}
