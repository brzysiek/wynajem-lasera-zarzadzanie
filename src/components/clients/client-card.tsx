"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CLINIC_TYPE_LABEL, formatNip, formatPhone } from "@/lib/clients/labels";
import type { ClientDetail, ClientHistoryItem } from "@/lib/clients/load";
import { Avatar, CalendarPlusIcon, PencilIcon, PhoneIcon, SmsIcon, StatusChip, fmtMoney } from "./ui";
import { BTN_GHOST, INPUT, SmsComposer, api } from "./client-forms";
import { EmailViewer } from "./email-viewer";
import { EventRow } from "./card/shared";
import { NextStep, OpenLeads, OverviewTiles } from "./card/tab-overview";

// Skrócona karta klienta — prawa kolumna listy /klienci (od 1280 px) albo
// panel wysuwany (docs/crm/zrzuty/lista-klientow.png). Treść = skrócony
// „Przegląd”; pełna karta z zakładkami: /klienci/[id] (nazwa i przycisk
// „Pełna karta klienta →”). Edycja osób i danych — w pełnej karcie.

export type CardIntent = "sms" | "note" | null;
type Panel = "sms" | "note" | null;

function personName(p: { firstName: string | null; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || null;
}

export function ClientCard({
  clientId,
  intent,
  onClose,
  onChanged,
}: {
  clientId: string;
  intent: CardIntent;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(intent);
  const [toast, setToast] = useState<string | null>(null);
  const [emailThread, setEmailThread] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void api<ClientDetail>(`/api/clients/${clientId}`, "GET").then(({ ok, data }) => {
      if (!alive) return;
      if (ok) setDetail(data);
      else setError(data.message ?? "Nie udało się wczytać klienta.");
    });
    return () => {
      alive = false;
    };
  }, [clientId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function saveNote() {
    setSaving(true);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${clientId}/activity`, "POST", { type: "NOTE", body: note });
    setSaving(false);
    if (!ok) return setToast(data.message ?? "Nie udało się zapisać.");
    setDetail(data.detail);
    setNote("");
    setPanel(null);
    setToast("Zapisano notatkę.");
    onChanged();
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-[var(--c-muted)]">
        {error}
        <button type="button" onClick={onClose} className={BTN_GHOST}>
          Zamknij
        </button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex h-full flex-col gap-4 p-6" aria-busy="true">
        <div className="flex gap-3">
          <div className="h-12 w-12 animate-pulse rounded-xl bg-[var(--c-bg)]" />
          <div className="flex flex-grow flex-col gap-2 pt-1">
            <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--c-bg)]" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--c-bg)]" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-[10px] bg-[var(--c-bg)]" />
          ))}
        </div>
      </div>
    );
  }

  const d = detail;
  const primary = d.contacts.find((c) => c.isPrimary) ?? d.contacts[0] ?? null;
  const smsRecipients = d.contacts.flatMap((c) =>
    [
      c.phone ? { label: `${personName(c) ?? "osoba"} · ${formatPhone(c.phone)}`, phone: c.phone } : null,
      c.phone2 ? { label: `${personName(c) ?? "osoba"} · ${c.phone2Label ?? "drugi"} ${formatPhone(c.phone2)}`, phone: c.phone2 } : null,
    ].filter((x): x is { label: string; phone: string } => Boolean(x)),
  );
  const recent = d.history.filter((h) => !(h.kind === "rental" && h.deleted)).slice(0, 6);
  const address = [d.street, [d.zip, d.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const transport = [d.transportPriceNet ? `${fmtMoney(Number(d.transportPriceNet))} netto` : null, d.distanceKm ? `${Number(d.distanceKm)} km` : null]
    .filter(Boolean)
    .join(" · ");
  const quick =
    "flex flex-col items-center gap-1 rounded-[10px] py-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const openItem = (h: ClientHistoryItem) => {
    if (h.kind === "email") setEmailThread(h.messageIds);
  };

  return (
    <div className="flex h-full max-h-[inherit] flex-col">
      {/* Nagłówek */}
      <div className="flex flex-col gap-2.5 border-b border-[var(--c-border)] px-6 pb-4 pt-[22px]">
        <div className="flex items-start gap-3">
          <Avatar name={d.name} id={d.id} size={48} />
          <div className="min-w-0 flex-grow">
            <Link href={`/klienci/${d.id}`} className="block text-[19px] font-semibold leading-tight text-[var(--c-navy)] hover:text-[var(--c-brand-deep)]">
              {d.name}
            </Link>
            <div className="text-[13px] text-[var(--c-muted)]">
              {[d.city, d.nip ? `NIP ${formatNip(d.nip)}` : null].filter(Boolean).join(" · ") || "brak adresu i NIP"}
            </div>
          </div>
          <StatusChip status={d.summary.status} />
          <button type="button" onClick={onClose} aria-label="Zamknij kartę" className="-mr-2 -mt-1 rounded-md p-1.5 text-[var(--c-muted)] hover:bg-[var(--c-bg)]">
            ✕
          </button>
        </div>
        {primary && (
          <div className="text-[13px]">
            <div>
              <b className="font-semibold text-[var(--c-navy)]">{personName(primary) ?? primary.email}</b>
              {primary.role && <span className="text-[var(--c-muted)]"> · {primary.role}</span>}
            </div>
            <div className="flex flex-wrap gap-x-3">
              {primary.phone && (
                <a href={`tel:${primary.phone}`} className="text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                  {formatPhone(primary.phone)}
                </a>
              )}
              {primary.email && (
                <a href={`mailto:${primary.email}`} className="truncate text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                  {primary.email}
                </a>
              )}
            </div>
          </div>
        )}
        <Link
          href={`/klienci/${d.id}`}
          className="self-start rounded-lg border border-[var(--c-brand)] px-3 py-1.5 text-[13px] font-semibold text-[var(--c-brand-deep)] transition-colors hover:bg-[var(--c-brand-soft)]"
        >
          Pełna karta klienta →
        </Link>
        <div className="mt-1 grid grid-cols-4 gap-2">
          {primary?.phone ? (
            <a href={`tel:${primary.phone}`} className={`${quick} bg-[var(--c-brand)] text-white hover:bg-[var(--c-brand-deep)]`}>
              <PhoneIcon size={18} />
              Zadzwoń
            </a>
          ) : (
            <button type="button" disabled className={`${quick} bg-[var(--c-brand)] text-white`} title="Brak telefonu">
              <PhoneIcon size={18} />
              Zadzwoń
            </button>
          )}
          <button
            type="button"
            disabled={smsRecipients.length === 0}
            title={smsRecipients.length === 0 ? "Brak telefonu" : undefined}
            onClick={() => setPanel(panel === "sms" ? null : "sms")}
            className={`${quick} bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)] hover:bg-[var(--c-navy-soft)]`}
          >
            <SmsIcon size={18} />
            SMS
          </button>
          <Link href={`/kalendarz/wynajem/nowy?klient=${d.id}`} className={`${quick} bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)] hover:bg-[var(--c-navy-soft)]`}>
            <CalendarPlusIcon />
            Rezerwacja
          </Link>
          <button type="button" onClick={() => setPanel(panel === "note" ? null : "note")} className={`${quick} bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)] hover:bg-[var(--c-navy-soft)]`}>
            <PencilIcon />
            Notatka
          </button>
        </div>
      </div>

      {/* Treść — skrócony Przegląd */}
      <div className="flex flex-grow flex-col gap-4 overflow-y-auto px-6 pb-6 pt-4">
        {toast && (
          <p role="status" className="rounded-lg bg-[var(--c-green-soft)] px-3 py-2 text-[13px] text-[var(--c-green-deep)]">
            {toast}
          </p>
        )}
        {panel === "sms" && (
          <SmsComposer
            recipients={smsRecipients}
            clientName={d.name}
            onCancel={() => setPanel(null)}
            onSent={() => {
              setPanel(null);
              setToast("SMS wysłany.");
              void api<ClientDetail>(`/api/clients/${clientId}`, "GET").then(({ ok, data }) => ok && setDetail(data));
            }}
          />
        )}
        {panel === "note" && (
          <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--c-brand)] p-3">
            <textarea autoFocus rows={3} className={`${INPUT} h-auto py-2`} placeholder="Notatka albo zapis rozmowy…" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPanel(null)} className={BTN_GHOST}>
                Anuluj
              </button>
              <button
                type="button"
                disabled={saving || !note.trim()}
                onClick={() => void saveNote()}
                className="h-9 rounded-lg bg-[var(--c-brand)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--c-brand-deep)] disabled:opacity-40"
              >
                Zapisz notatkę
              </button>
            </div>
          </div>
        )}

        {d.statusOverride === "NIE_KONTAKTOWAC" && (
          <p className="rounded-[10px] bg-[var(--c-red-soft)] px-3.5 py-2.5 text-[13px] text-[var(--c-red)]">
            <b className="font-semibold">Nie kontaktować.</b> Klient oznaczony blokadą — nie proponuj terminów ani ofert.
          </p>
        )}

        <OverviewTiles d={d} cols={2} />
        <NextStep d={d} />
        <OpenLeads d={d} />

        <div className="flex flex-col gap-2.5">
          <div className="flex items-center">
            <h3 className="m-0 flex-grow text-sm font-semibold text-[var(--c-navy)]">Historia</h3>
            <Link href={`/klienci/${d.id}?tab=komunikacja`} className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
              Cała komunikacja →
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-[13px] text-[var(--c-faint)]">Brak wynajmów i wiadomości.</p>
          ) : (
            recent.map((h) => <EventRow key={`${h.kind}-${h.id}`} item={h} onOpen={openItem} compact />)
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <h3 className="m-0 text-sm font-semibold text-[var(--c-navy)]">Dane do wynajmu</h3>
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-1 text-[13px]">
            <dt className="text-[var(--c-muted)]">Adres</dt>
            <dd>{address || <span className="text-[var(--c-faint)]">—</span>}</dd>
            <dt className="text-[var(--c-muted)]">Transport</dt>
            <dd>{transport || <span className="text-[var(--c-faint)]">—</span>}</dd>
            <dt className="text-[var(--c-muted)]">Rodzaj gabinetu</dt>
            <dd>{d.clinicType ? CLINIC_TYPE_LABEL[d.clinicType] : <span className="text-[var(--c-faint)]">—</span>}</dd>
            {d.notes && (
              <>
                <dt className="text-[var(--c-muted)]">Ustalenia</dt>
                <dd className="whitespace-pre-line">{d.notes}</dd>
              </>
            )}
          </dl>
        </div>
      </div>
      {emailThread && <EmailViewer messageIds={emailThread} onClose={() => setEmailThread(null)} />}
    </div>
  );
}
