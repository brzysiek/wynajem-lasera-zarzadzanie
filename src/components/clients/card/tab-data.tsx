"use client";

import { useState } from "react";
import type { ClientContactDto, ClientDetail } from "@/lib/clients/load";
import { CLINIC_TYPE_LABEL, DEVICE_INTEREST_LABEL, SOURCE_LABEL, formatNip, formatPhone } from "@/lib/clients/labels";
import { ClientDataForm, ContactForm, NoteEditor, api } from "../client-forms";
import { PencilIcon, fmtMoney } from "../ui";
import { Panel } from "./shared";

// Zakładka „Dane” (prompt 3B-karta, 2.4): osoby kontaktowe (dwa numery),
// firma i adres, dane do wynajmu (stałe ustalenia = dawna notatka klienta,
// forma płatności wyliczana z historii), powiązania (HubSpot, Fakturownia,
// aliasy z kalendarza z możliwością usunięcia błędnego).

function personName(c: { firstName: string | null; lastName: string | null }) {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[var(--c-muted)]">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-[var(--c-faint)]">—</span>}</dd>
    </>
  );
}

function ContactCard({
  c,
  busy,
  onEdit,
  onMakePrimary,
  onDelete,
}: {
  c: ClientContactDto;
  busy: boolean;
  onEdit: () => void;
  onMakePrimary: () => void;
  onDelete: () => void;
}) {
  const name = personName(c) ?? c.email ?? "Bez nazwy";
  return (
    <div className="rounded-[10px] border border-[var(--c-border)] px-4 py-3">
      <div className="flex items-center gap-2">
        <b className="min-w-0 truncate text-[14px] font-semibold text-[var(--c-navy)]">{name}</b>
        {c.isPrimary && <span className="rounded-full bg-[var(--c-brand-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--c-brand-deep)]">główna</span>}
        <button type="button" onClick={onEdit} aria-label={`Edytuj ${name}`} className="ml-auto rounded p-1 text-[var(--c-muted)] hover:bg-[var(--c-bg)] hover:text-[var(--c-brand-deep)]">
          <PencilIcon size={14} />
        </button>
      </div>
      <dl className="mt-1.5 grid grid-cols-[110px_minmax(0,1fr)] gap-y-1 text-[13.5px]">
        {c.role && <Row label="Rola">{c.role}</Row>}
        <Row label={c.phone2 ? "Tel." : "Telefon"}>
          {c.phone && (
            <a href={`tel:${c.phone}`} className="text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
              {formatPhone(c.phone)}
            </a>
          )}
        </Row>
        {c.phone2 && (
          <Row label={`Tel. ${c.phone2Label ?? "drugi"}`}>
            <a href={`tel:${c.phone2}`} className="text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
              {formatPhone(c.phone2)}
            </a>
          </Row>
        )}
        <Row label="E-mail">
          {c.email && (
            <a href={`mailto:${c.email}`} className="text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
              {c.email}
            </a>
          )}
        </Row>
      </dl>
      <div className="mt-2 flex gap-3 text-xs">
        {!c.isPrimary && (
          <button type="button" disabled={busy} onClick={onMakePrimary} className="font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)] disabled:opacity-40">
            Ustaw jako główną
          </button>
        )}
        <button type="button" disabled={busy} onClick={onDelete} className="font-semibold text-[var(--c-muted)] hover:text-[var(--c-red)] disabled:opacity-40">
          Usuń
        </button>
        {c.rentalsCount > 0 && <span className="text-[var(--c-faint)]">{c.rentalsCount} wyn.</span>}
      </div>
    </div>
  );
}

export function TabData({
  d,
  onChanged,
  notify,
  isAdmin = false,
}: {
  d: ClientDetail;
  onChanged: (next: ClientDetail) => void;
  notify: (text: string, error?: boolean) => void;
  isAdmin?: boolean;
}) {
  const [editing, setEditing] = useState<"client" | "notes" | { contact: string | "new" } | null>(null);
  const [busy, setBusy] = useState(false);

  function saved(next: ClientDetail, refreshed = 0, message = "Zapisano.") {
    setEditing(null);
    onChanged(next);
    notify(refreshed > 0 ? `Zapisano i zaktualizowano ${refreshed} nadchodzących wynajmów.` : message);
  }

  async function makePrimary(c: ClientContactDto) {
    setBusy(true);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/contacts/${c.id}`, "PATCH", { isPrimary: true });
    setBusy(false);
    if (ok) saved(data.detail, 0, "Zmieniono osobę główną.");
    else notify(data.message ?? "Nie udało się.", true);
  }

  async function deleteContact(c: ClientContactDto) {
    if (!window.confirm(`Usunąć ${personName(c) ?? c.email ?? "tę osobę"} z klienta? W HubSpocie nic się nie zmieni.`)) return;
    setBusy(true);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/contacts/${c.id}`, "DELETE");
    setBusy(false);
    if (ok) saved(data.detail, 0, "Usunięto osobę.");
    else notify(data.message ?? "Nie udało się usunąć.", true);
  }

  async function removeAlias(alias: string) {
    if (!window.confirm(`Usunąć alias „${alias}”? Wydarzenia z kalendarza o tym tytule wrócą do dopasowania automatycznego.`)) return;
    setBusy(true);
    const r = await api("/api/history/decide", "POST", { action: "reset", keys: [alias] });
    const next = r.ok ? await api<ClientDetail>(`/api/clients/${d.id}`, "GET") : null;
    setBusy(false);
    if (next?.ok) saved(next.data, 0, "Usunięto alias.");
    else notify(r.data.message ?? "Nie udało się usunąć aliasu.", true);
  }

  async function setQualification(action: "qualify" | "unqualify") {
    let note = "";
    if (action === "unqualify") {
      note = window.prompt("Powód cofnięcia kwalifikacji (np. pomyłka, spam):")?.trim() ?? "";
      if (!note) return;
    }
    setBusy(true);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/qualification`, "POST", { action, note });
    setBusy(false);
    if (ok) saved(data.detail, 0, action === "qualify" ? "Zakwalifikowano jako klienta." : "Cofnięto kwalifikację.");
    else notify(data.message ?? "Nie udało się.", true);
  }

  const edit = (label = "Edytuj", onClick: () => void) => (
    <button type="button" onClick={onClick} className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
      {label}
    </button>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel
        title="Osoby kontaktowe"
        action={
          <button
            type="button"
            onClick={() => setEditing({ contact: "new" })}
            className="h-8 rounded-lg border border-[var(--c-brand)] px-3 text-[13px] font-semibold text-[var(--c-brand-deep)] transition-colors hover:bg-[var(--c-brand-soft)]"
          >
            + Dodaj osobę
          </button>
        }
      >
        <div className="flex flex-col gap-3">
          {typeof editing === "object" && editing && editing.contact === "new" && (
            <ContactForm clientId={d.id} contact={null} onCancel={() => setEditing(null)} onSaved={(n, r) => saved(n, r, "Dodano osobę.")} />
          )}
          {d.suggestedEmails.length > 0 && (
            <div className="rounded-[10px] bg-[var(--c-gold-soft)] px-3 py-2 text-[13px]">
              <p className="text-[var(--c-gold-deep)]">E-maile z nowych adresów w domenie klienta:</p>
              {d.suggestedEmails.map((email) => (
                <div key={email} className="mt-1 flex items-center gap-2">
                  <span className="min-w-0 flex-grow truncate">{email}</span>
                  <button
                    type="button"
                    className="flex-none text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]"
                    onClick={async () => {
                      const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/contacts`, "POST", { email });
                      if (ok) saved(data.detail, 0, "Dodano osobę kontaktową.");
                      else notify(data.message ?? "Nie udało się.", true);
                    }}
                  >
                    + Dodaj jako osobę
                  </button>
                </div>
              ))}
            </div>
          )}
          {d.contacts.map((c) =>
            typeof editing === "object" && editing && editing.contact === c.id ? (
              <ContactForm key={c.id} clientId={d.id} contact={c} onCancel={() => setEditing(null)} onSaved={(n, r) => saved(n, r)} />
            ) : (
              <ContactCard
                key={c.id}
                c={c}
                busy={busy}
                onEdit={() => setEditing({ contact: c.id })}
                onMakePrimary={() => void makePrimary(c)}
                onDelete={() => void deleteContact(c)}
              />
            ),
          )}
          {d.contacts.length === 0 && <p className="text-[13px] text-[var(--c-faint)]">Brak osób kontaktowych.</p>}
        </div>
      </Panel>

      <div className="flex flex-col gap-5">
        <Panel title="Firma i adres" action={editing !== "client" && edit("Edytuj", () => setEditing("client"))}>
          {editing === "client" ? (
            <ClientDataForm detail={d} onCancel={() => setEditing(null)} onSaved={(n, r) => saved(n, r)} />
          ) : (
            <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-y-1.5 text-[14px]">
              <Row label="Nazwa">{d.name}</Row>
              <Row label="NIP">{d.nip ? formatNip(d.nip) : null}</Row>
              <Row label="Ulica">{d.street}</Row>
              <Row label="Kod i miasto">{[d.zip, d.city].filter(Boolean).join(" ")}</Row>
              <Row label="Rodzaj gabinetu">{d.clinicType ? CLINIC_TYPE_LABEL[d.clinicType] : null}</Row>
              <Row label="Źródło">{d.source ? SOURCE_LABEL[d.source] : null}</Row>
            </dl>
          )}
        </Panel>

        <Panel title="Dane do wynajmu">
          <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-y-1.5 text-[14px]">
            <Row label="Transport">
              {[d.transportPriceNet ? `${fmtMoney(Number(d.transportPriceNet))} netto` : null, d.distanceKm ? `${Number(d.distanceKm)} km` : null].filter(Boolean).join(" · ")}
            </Row>
            <dt className="text-[var(--c-muted)]">Stałe ustalenia</dt>
            <dd className="min-w-0">
              {editing === "notes" ? (
                <NoteEditor clientId={d.id} notes={d.notes} onCancel={() => setEditing(null)} onSaved={(n) => saved(n, 0, "Zapisano ustalenia.")} />
              ) : (
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-grow whitespace-pre-line">{d.notes || <span className="text-[var(--c-faint)]">np. dostawa przed 8:00, piętro, winda</span>}</span>
                  {edit(d.notes ? "Edytuj" : "Dodaj", () => setEditing("notes"))}
                </span>
              )}
            </dd>
            <Row label="Płatność">{d.overview.typicalPayment}</Row>
            <Row label="Zainteresowania">{d.deviceInterests.map((k) => DEVICE_INTEREST_LABEL[k]).join(", ")}</Row>
          </dl>
          <p className="mt-2 text-[11px] text-[var(--c-faint)]">Transport i zainteresowania zmienisz w „Firma i adres → Edytuj”; forma płatności wynika z historii faktur.</p>
        </Panel>

        <Panel title="Powiązania">
          <div className="flex flex-col gap-1.5 text-[13px] text-[var(--c-sidebar-text)]">
            <p>
              HubSpot:{" "}
              {d.hubspotUrl ? (
                <a href={d.hubspotUrl} target="_blank" rel="noreferrer" className="text-[var(--c-brand)] hover:underline">
                  otwórz kontakt ↗
                </a>
              ) : (
                "brak powiązania"
              )}
              {d.legacyHubspotTag && ` · tagi z HubSpota: ${d.legacyHubspotTag}`}
            </p>
            <p>Fakturownia: {d.nip ? `kontrahent po NIP ${formatNip(d.nip)}` : "brak NIP — faktury dopasowywane po nazwie"}</p>
            {d.qualification.active && (
              <p>
                Lista klientów:{" "}
                {d.qualification.qualified
                  ? d.qualification.derived
                    ? "klient (ma wynajem, historię albo fakturę)"
                    : `klient od ${d.qualification.at ? new Date(d.qualification.at).toLocaleDateString("pl-PL") : "—"}`
                  : "kontakt z zapytania — przejdzie do klientów po rozmowie albo odpowiedzi mailem"}
                {isAdmin && !d.qualification.qualified && (
                  <button type="button" disabled={busy} onClick={() => void setQualification("qualify")} className="ml-2 text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                    Zakwalifikuj
                  </button>
                )}
                {isAdmin && d.qualification.qualified && !d.qualification.derived && (
                  <button type="button" disabled={busy} onClick={() => void setQualification("unqualify")} className="ml-2 text-xs font-semibold text-[var(--c-muted)] hover:text-[var(--c-red)]">
                    Cofnij kwalifikację
                  </button>
                )}
              </p>
            )}
            <div>
              Aliasy z kalendarza:{" "}
              {d.aliases.length === 0 ? (
                "brak"
              ) : (
                <span className="inline-flex flex-wrap gap-1.5 align-middle">
                  {d.aliases.map((a) => (
                    <span key={a} className="inline-flex items-center gap-1 rounded-full bg-[var(--c-bg)] py-0.5 pl-2.5 pr-1 text-xs">
                      „{a}”
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeAlias(a)}
                        aria-label={`Usuń alias ${a}`}
                        className="flex h-4 w-4 items-center justify-center rounded-full text-[var(--c-muted)] hover:bg-[var(--c-red-soft)] hover:text-[var(--c-red)]"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
