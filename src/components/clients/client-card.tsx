"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CLINIC_TYPE_LABEL, DEVICE_INTEREST_LABEL, SOURCE_LABEL, formatNip, formatPhone } from "@/lib/clients/labels";
import type { ClientContactDto, ClientDetail, ClientHistoryItem } from "@/lib/clients/load";
import { Avatar, CalendarPlusIcon, DeviceTags, PencilIcon, PhoneIcon, SmsIcon, StatusChip, fmtAgo, fmtDate, fmtMoney } from "./ui";
import { BTN_GHOST, ClientDataForm, ContactForm, NoteEditor, SmsComposer, api } from "./client-forms";

// Karta klienta — prawa kolumna listy (od 1280 px) albo panel wysuwany.
// Układ i kolejność sekcji wg docs/crm/mockup-klienci.html; sekcje z
// makiety, które należą do etapu 2 (Sygnały: „Następny krok”, „Otwarte
// sygnały”, rozmowy w historii) — pominięte do czasu modułu Sygnały.

export type CardIntent = "sms" | "note" | null;
type Panel = "sms" | "note" | "data" | { contact: string | "new" } | null;

function personName(p: { firstName: string | null; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || null;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[10px] bg-[var(--c-bg)] px-3 py-2.5">
      <div className="text-xs text-[var(--c-muted)]">{label}</div>
      <div className="truncate text-lg font-semibold text-[var(--c-navy)] tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-[var(--c-muted)]">{sub}</div>}
    </div>
  );
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center">
      <h3 className="m-0 flex-grow text-sm font-semibold text-[var(--c-navy)]">{children}</h3>
      {action}
    </div>
  );
}

function HistoryRow({ item }: { item: ClientHistoryItem }) {
  if (item.kind === "rental") {
    const state = item.deleted ? "usunięty w Google" : item.upcoming ? "zaplanowany" : item.settled ? "rozliczony" : "do rozliczenia";
    return (
      <Link href={`/kalendarz/wynajem/${item.id}?from=/klienci`} className="group flex gap-2.5 rounded-lg p-1 -m-1 hover:bg-[var(--c-bg)]">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--c-green-soft)] text-[11px] font-bold text-[var(--c-green-deep)]">
          {item.eventType === "SZKOLENIE" ? "K" : "R"}
        </span>
        <span className="min-w-0 flex-grow">
          <span className={`block text-[13px] ${item.deleted ? "text-[var(--c-faint)] line-through" : "text-[var(--c-text)]"}`}>
            {item.eventType === "SZKOLENIE" ? "Szkolenie" : "Wynajem"} {item.deviceName} — {state}
          </span>
          <span className="flex gap-1.5 text-[11px] text-[var(--c-muted)]">
            {fmtDate(item.at)}
            {item.totalNet != null && <span>· {fmtMoney(item.totalNet)} netto</span>}
          </span>
        </span>
      </Link>
    );
  }
  if (item.kind === "history") {
    return (
      <div className="flex gap-2.5" title={`Tytuł w kalendarzu: ${item.title}`}>
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--c-bg)] text-[11px] font-bold text-[var(--c-muted)]">
          {item.eventType === "SZKOLENIE" ? "K" : "R"}
        </span>
        <span className="min-w-0 flex-grow">
          <span className="block text-[13px] text-[var(--c-text)]">
            {item.eventType === "SZKOLENIE" ? "Szkolenie" : "Wynajem"} {item.deviceName}
          </span>
          <span className="flex gap-1.5 text-[11px] text-[var(--c-muted)]">
            {fmtDate(item.at)}
            <span>· z kalendarza</span>
          </span>
        </span>
      </div>
    );
  }
  const sms = item.channel === "SMS";
  return (
    <div className="flex gap-2.5">
      <span
        className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-bold ${
          sms ? "bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]" : "bg-[var(--c-gold-soft)] text-[var(--c-gold-deep)]"
        }`}
      >
        {sms ? "S" : "M"}
      </span>
      <span className="min-w-0 flex-grow">
        <span className="line-clamp-2 block text-[13px] text-[var(--c-text)]">
          {sms ? "SMS" : "E-mail"}: {item.body}
        </span>
        <span className="flex gap-1.5 text-[11px] text-[var(--c-muted)]">
          {fmtDate(item.at)}
          {item.failed && <span className="font-semibold text-[var(--c-red)]">· nie wysłano</span>}
        </span>
      </span>
    </div>
  );
}

function ContactRow({
  contact,
  onEdit,
  onMakePrimary,
  onDelete,
  busy,
}: {
  contact: ClientContactDto;
  onEdit: () => void;
  onMakePrimary: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const name = personName(contact) ?? contact.email ?? "Bez nazwy";
  return (
    <div className="group rounded-[10px] border border-[var(--c-border)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-grow truncate text-[13px] font-semibold text-[var(--c-navy)]">
          {name}
          {contact.role && <span className="font-normal text-[var(--c-muted)]"> · {contact.role}</span>}
        </span>
        {contact.isPrimary && (
          <span className="rounded-full bg-[var(--c-brand-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--c-brand-deep)]">główna</span>
        )}
        <button type="button" onClick={onEdit} aria-label={`Edytuj ${name}`} className="rounded p-1 text-[var(--c-muted)] hover:bg-[var(--c-bg)] hover:text-[var(--c-brand-deep)]">
          <PencilIcon size={14} />
        </button>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[13px]">
        {contact.phone ? (
          <a href={`tel:${contact.phone}`} className="text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
            {formatPhone(contact.phone)}
          </a>
        ) : (
          <span className="text-[var(--c-faint)]">brak telefonu</span>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="truncate text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
            {contact.email}
          </a>
        )}
      </div>
      <div className="mt-1 flex gap-3 text-[11px]">
        {!contact.isPrimary && (
          <button type="button" disabled={busy} onClick={onMakePrimary} className="font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)] disabled:opacity-40">
            Ustaw jako główną
          </button>
        )}
        <button type="button" disabled={busy} onClick={onDelete} className="font-semibold text-[var(--c-muted)] hover:text-[var(--c-red)] disabled:opacity-40">
          Usuń
        </button>
        {contact.rentalsCount > 0 && <span className="text-[var(--c-faint)]">{contact.rentalsCount} wyn.</span>}
      </div>
    </div>
  );
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
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [busy, setBusy] = useState(false);

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

  function applied(next: ClientDetail, refreshedRentals = 0, message = "Zapisano.") {
    setDetail(next);
    setPanel(null);
    setToast(
      refreshedRentals > 0
        ? `Zaktualizowano dane na ${refreshedRentals} ${refreshedRentals === 1 ? "nadchodzącym wynajmie" : "nadchodzących wynajmach"}.`
        : message,
    );
    onChanged();
  }

  async function makePrimary(c: ClientContactDto) {
    setBusy(true);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${clientId}/contacts/${c.id}`, "PATCH", { isPrimary: true });
    setBusy(false);
    if (ok) applied(data.detail, 0, "Zmieniono osobę główną.");
    else setToast(data.message ?? "Nie udało się.");
  }

  async function deleteContact(c: ClientContactDto) {
    const name = personName(c) ?? c.email ?? "tę osobę";
    if (!window.confirm(`Usunąć ${name} z klienta? W HubSpocie nic się nie zmieni.`)) return;
    setBusy(true);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${clientId}/contacts/${c.id}`, "DELETE");
    setBusy(false);
    if (ok) applied(data.detail, 0, "Usunięto osobę.");
    else setToast(data.message ?? "Nie udało się usunąć.");
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
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-[10px] bg-[var(--c-bg)]" />
          ))}
        </div>
      </div>
    );
  }

  const primary = detail.contacts.find((c) => c.isPrimary) ?? detail.contacts[0] ?? null;
  const smsRecipients = detail.contacts
    .filter((c) => c.phone)
    .map((c) => ({ label: `${personName(c) ?? "osoba"} · ${formatPhone(c.phone)}`, phone: c.phone as string }));
  const s = detail.summary;
  const history = showAllHistory ? detail.history : detail.history.slice(0, 6);
  const address = [detail.street, [detail.zip, detail.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const transport = [
    detail.transportPriceNet ? `${fmtMoney(Number(detail.transportPriceNet))} netto` : null,
    detail.distanceKm ? `${Number(detail.distanceKm)} km` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const quick =
    "flex flex-col items-center gap-1 rounded-[10px] py-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex h-full max-h-[inherit] flex-col">
      {/* Nagłówek */}
      <div className="flex flex-col gap-2.5 border-b border-[var(--c-border)] px-6 pb-4 pt-[22px]">
        <div className="flex items-start gap-3">
          <Avatar name={detail.name} id={detail.id} size={48} />
          <div className="min-w-0 flex-grow">
            <h2 className="m-0 text-[19px] font-semibold leading-tight text-[var(--c-navy)]">{detail.name}</h2>
            <div className="text-[13px] text-[var(--c-muted)]">
              {[detail.city, detail.nip ? `NIP ${formatNip(detail.nip)}` : null].filter(Boolean).join(" · ") || "brak adresu i NIP"}
            </div>
          </div>
          <StatusChip status={s.status} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij kartę klienta"
            className="-mr-2 -mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-full text-[var(--c-muted)] hover:bg-[var(--c-bg)] hover:text-[var(--c-text)]"
          >
            ✕
          </button>
        </div>
        {primary && (
          <div className="flex flex-col gap-[3px] text-sm">
            <div>
              <strong className="font-semibold">{personName(primary) ?? "Osoba kontaktowa"}</strong>
              {primary.role && <span className="text-[var(--c-muted)]"> · {primary.role}</span>}
            </div>
            <div className="flex flex-wrap gap-x-3.5 text-[var(--c-brand-deep)]">
              {primary.phone && (
                <a href={`tel:${primary.phone}`} className="hover:underline">
                  {formatPhone(primary.phone)}
                </a>
              )}
              {primary.email && (
                <a href={`mailto:${primary.email}`} className="truncate hover:underline">
                  {primary.email}
                </a>
              )}
            </div>
          </div>
        )}
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
          <Link
            href={`/kalendarz/wynajem/nowy?klient=${detail.id}`}
            className={`${quick} bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)] hover:bg-[var(--c-navy-soft)]`}
          >
            <CalendarPlusIcon />
            Rezerwacja
          </Link>
          <button
            type="button"
            onClick={() => setPanel(panel === "note" ? null : "note")}
            className={`${quick} bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)] hover:bg-[var(--c-navy-soft)]`}
          >
            <PencilIcon />
            Notatka
          </button>
        </div>
      </div>

      {/* Treść */}
      <div className="flex flex-grow flex-col gap-[18px] overflow-y-auto px-6 pb-6 pt-4">
        {toast && (
          <p role="status" className="rounded-lg bg-[var(--c-green-soft)] px-3 py-2 text-[13px] text-[var(--c-green-deep)]">
            {toast}
          </p>
        )}

        {panel === "sms" && (
          <SmsComposer
            recipients={smsRecipients}
            clientName={detail.name}
            onCancel={() => setPanel(null)}
            onSent={() => {
              setPanel(null);
              setToast("SMS wysłany.");
              void api<ClientDetail>(`/api/clients/${clientId}`, "GET").then(({ ok, data }) => ok && setDetail(data));
            }}
          />
        )}
        {panel === "note" && (
          <NoteEditor clientId={detail.id} notes={detail.notes} onCancel={() => setPanel(null)} onSaved={(d) => applied(d, 0, "Zapisano notatkę.")} />
        )}

        {detail.statusOverride === "NIE_KONTAKTOWAC" && (
          <p className="rounded-[10px] border border-[var(--c-red-soft)] bg-[var(--c-red-soft)] px-3.5 py-2.5 text-[13px] text-[var(--c-red)]">
            <b className="font-semibold">Nie kontaktować.</b> Klient oznaczony blokadą — nie proponuj terminów ani ofert.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <Stat label="Wynajmy (12 mies. / łącznie)" value={`${s.rentals12m} / ${s.rentalsTotal}`} />
          <Stat
            label="Przychód netto łącznie"
            value={s.revenueNet > 0 ? fmtMoney(s.revenueNet) : "—"}
            sub={s.avgRentalNet ? `śr. ${fmtMoney(s.avgRentalNet)} / wynajem` : undefined}
          />
          <Stat label="Ostatni wynajem" value={s.lastRentalAt ? fmtDate(s.lastRentalAt) : "—"} sub={s.lastRentalAt ? fmtAgo(s.lastRentalAt) : undefined} />
          <Stat label="Ulubione urządzenie" value={s.favoriteDevice ? DEVICE_INTEREST_LABEL[s.favoriteDevice] : "—"} />
        </div>
        {s.firstSeenAt && (
          <p className="-mt-2.5 text-xs text-[var(--c-muted)]">
            Klient od{" "}
            <b className="font-semibold text-[var(--c-text)]">
              {new Date(s.firstSeenAt).toLocaleDateString("pl-PL", { month: "2-digit", year: "numeric" })}
            </b>
            {detail.history.some((h) => h.kind === "history") && " · z historią z kalendarzy"}
          </p>
        )}

        {detail.notes && panel !== "note" && (
          <button
            type="button"
            onClick={() => setPanel("note")}
            className="flex gap-2.5 rounded-[10px] border border-[var(--c-accent-soft)] bg-[var(--c-accent-soft)] px-3.5 py-3 text-left transition-colors hover:border-[var(--c-accent)]"
          >
            <PencilIcon size={18} className="mt-px flex-none text-[var(--c-accent-deep)]" />
            <span className="text-[13px]">
              <span className="block font-semibold text-[var(--c-accent-deep)]">Notatka</span>
              <span className="whitespace-pre-line">{detail.notes}</span>
            </span>
          </button>
        )}

        <div className="flex flex-col gap-2.5">
          <SectionTitle>Historia</SectionTitle>
          {detail.history.length === 0 ? (
            <p className="text-[13px] text-[var(--c-faint)]">Brak wynajmów i wiadomości.</p>
          ) : (
            <>
              {history.map((h) => (
                <HistoryRow key={`${h.kind}-${h.id}`} item={h} />
              ))}
              {detail.history.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllHistory((v) => !v)}
                  className="self-start text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]"
                >
                  {showAllHistory ? "Zwiń" : `Pokaż całą historię (${detail.history.length})`}
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => setPanel({ contact: "new" })}
                className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]"
              >
                + Dodaj osobę
              </button>
            }
          >
            Osoby kontaktowe
          </SectionTitle>
          {detail.contacts.map((c) =>
            typeof panel === "object" && panel?.contact === c.id ? (
              <ContactForm key={c.id} clientId={detail.id} contact={c} onCancel={() => setPanel(null)} onSaved={(d, n) => applied(d, n)} />
            ) : (
              <ContactRow
                key={c.id}
                contact={c}
                busy={busy}
                onEdit={() => setPanel({ contact: c.id })}
                onMakePrimary={() => void makePrimary(c)}
                onDelete={() => void deleteContact(c)}
              />
            ),
          )}
          {typeof panel === "object" && panel?.contact === "new" && (
            <ContactForm clientId={detail.id} contact={null} onCancel={() => setPanel(null)} onSaved={(d, n) => applied(d, n, "Dodano osobę.")} />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionTitle
            action={
              panel !== "data" && (
                <button type="button" onClick={() => setPanel("data")} className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                  Edytuj
                </button>
              )
            }
          >
            Dane do wynajmu
          </SectionTitle>
          {panel === "data" ? (
            <ClientDataForm detail={detail} onCancel={() => setPanel(null)} onSaved={(d, n) => applied(d, n)} />
          ) : (
            <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-y-1 text-[13px]">
              <span className="text-[var(--c-muted)]">Adres</span>
              <span>{address || <span className="text-[var(--c-faint)]">—</span>}</span>
              <span className="text-[var(--c-muted)]">Transport</span>
              <span>{transport || <span className="text-[var(--c-faint)]">—</span>}</span>
              <span className="text-[var(--c-muted)]">Rodzaj gabinetu</span>
              <span>{detail.clinicType ? CLINIC_TYPE_LABEL[detail.clinicType] : <span className="text-[var(--c-faint)]">—</span>}</span>
              <span className="text-[var(--c-muted)]">Źródło</span>
              <span>{detail.source ? SOURCE_LABEL[detail.source] : <span className="text-[var(--c-faint)]">—</span>}</span>
              <span className="text-[var(--c-muted)]">Zainteresowania</span>
              <span>
                <DeviceTags devices={detail.deviceInterests} max={6} />
              </span>
            </div>
          )}
        </div>

        {(detail.hubspotUrl || detail.legacyHubspotTag) && (
          <div className="flex flex-col gap-1 border-t border-[var(--c-border)] pt-3 text-xs text-[var(--c-muted)]">
            {detail.hubspotUrl && (
              <a href={detail.hubspotUrl} target="_blank" rel="noreferrer" className="font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                Otwórz w HubSpot ↗
              </a>
            )}
            {detail.legacyHubspotTag && <span>Tagi z HubSpota: {detail.legacyHubspotTag}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
