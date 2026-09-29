"use client";

import { useState, type ReactNode } from "react";
import type { ClientDetail } from "@/lib/clients/load";
import type { DeliveryAddressDto } from "@/lib/clients/delivery";
import { routeLabel, splitFeedback, zoneFor } from "@/lib/clients/delivery-rules";
import { api, INPUT } from "../client-forms";
import { BTN_OUTLINE, BTN_PRIMARY, LINK, Missing, Section, dm, money } from "./kit";
import { TransportFixed, useTermsSaver } from "./card-terms";

// Paszport dostawy (karta klienta, etap B, wg karta-kierunek.html): adresy
// dostawy — domyślny podstawia się w rezerwacji i na mapie — z trasą od bazy
// (OSRM, liczona przy zapisie), polami „na miejscu”, uwagami biura i uwagami
// kierowców (ostatnie 3, reszta pod „więcej”). Wszystko widzi kierowca.

type Props = { d: ClientDetail; onChanged: (next: ClientDetail) => void; notify: (text: string, error?: boolean) => void; isAgent: boolean };

const TAG = "ml-1 inline-block px-1.5 py-px align-[1px] text-[9px] font-semibold uppercase tracking-[0.1em]";
const FLD = "grid items-baseline gap-2 border-b border-[#F0F1F2] py-1 last:border-0";
const FLD_LABEL = "pt-[3px] text-[9.5px] uppercase tracking-[0.12em] text-[#5C6166]";

function Fld({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className={FLD} style={{ gridTemplateColumns: "110px minmax(0,1fr)" }}>
      <span className={FLD_LABEL}>{label}</span>
      <span className="min-w-0 text-[13px] text-[#333333]">{children}</span>
    </div>
  );
}

const ON_SITE: { key: keyof DeliveryAddressDto; label: string }[] = [
  { key: "entrance", label: "wejście" },
  { key: "floor", label: "piętro / winda" },
  { key: "parking", label: "parking" },
  { key: "power", label: "prąd" },
  { key: "receiver", label: "odbiera" },
  { key: "openingHours", label: "godziny" },
];

function OnSite({ a, usual }: { a: DeliveryAddressDto; usual: string | null }) {
  const parts = ON_SITE.filter((f) => a[f.key]).map((f) => (
    <span key={f.key}>
      <span className="text-[#767C82]">{f.label}:</span> {String(a[f.key])}
    </span>
  ));
  const time = a.usualStartTime ? `dostawa zwykle ${a.usualStartTime}` : usual;
  if (time) parts.push(<span key="time">{time}</span>);
  if (!parts.length) return <span className="text-[#8A939B]">wejście · piętro/winda · parking · gniazdko/prąd · kto odbiera · godziny otwarcia · typowa godzina dostawy</span>;
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {p}
        </span>
      ))}
    </>
  );
}

function DriverNotes({ a }: { a: DeliveryAddressDto }) {
  const [open, setOpen] = useState(false);
  const { shown, more } = splitFeedback(a.feedback);
  const line = (f: DeliveryAddressDto["feedback"][number]) => (
    <div key={f.id}>
      <span className="tabular-nums text-[#767C82]">{dm(f.rentalAt ?? f.createdAt)}</span>
      {f.driverName && <span className="text-[#767C82]"> · {f.driverName}</span>}: {f.text}
    </div>
  );
  if (!a.feedback.length) return <span className="text-[#8A939B]">brak — kierowca wpisuje po dostawie / odbiorze</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {shown.map(line)}
      {open && more.map(line)}
      {more.length > 0 && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="self-start text-[12px] text-[#1B6FA8] hover:text-[#0C3450]">
          {open ? "mniej ▴" : `więcej (${more.length}) ▾`}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ edycja

type Draft = Record<"label" | "street" | "zip" | "city" | "entrance" | "floor" | "parking" | "power" | "receiver" | "openingHours" | "usualStartTime" | "officeNotes", string>;

const EDIT_FIELDS: { key: keyof Draft; label: string; placeholder?: string; area?: boolean }[] = [
  { key: "label", label: "Nazwa", placeholder: "Gabinet, Wieliczka…" },
  { key: "street", label: "Ulica i numer" },
  { key: "zip", label: "Kod", placeholder: "32-060" },
  { key: "city", label: "Miejscowość" },
  { key: "entrance", label: "Wejście", placeholder: "od podwórza, domofon 12" },
  { key: "floor", label: "Piętro / winda" },
  { key: "parking", label: "Parking" },
  { key: "power", label: "Prąd", placeholder: "gniazdko, bezpiecznik" },
  { key: "receiver", label: "Kto odbiera" },
  { key: "openingHours", label: "Godziny otwarcia", placeholder: "pn–pt 9–20 · sob 9–15" },
  { key: "usualStartTime", label: "Typowa godzina dostawy", placeholder: "09:00" },
  { key: "officeNotes", label: "Uwagi biura", area: true, placeholder: "np. dzwonić 15 min przed przyjazdem" },
];

function draftOf(a: DeliveryAddressDto | null, d: ClientDetail): Draft {
  const blank = Object.fromEntries(EDIT_FIELDS.map((f) => [f.key, ""])) as Draft;
  if (!a) {
    // Pierwszy adres: podpowiedź z adresu firmy.
    const first = d.delivery.addresses.length === 0;
    return { ...blank, label: first ? "Gabinet" : "", street: first ? (d.street ?? "") : "", zip: first ? (d.zip ?? "") : "", city: first ? (d.city ?? "") : "" };
  }
  return Object.fromEntries(EDIT_FIELDS.map((f) => [f.key, (a[f.key] as string | null) ?? ""])) as Draft;
}

function AddressEditor({ d, a, onDone, onChanged, notify }: { d: ClientDetail; a: DeliveryAddressDto | null; onDone: () => void } & Pick<Props, "onChanged" | "notify">) {
  const [v, setV] = useState<Draft>(() => draftOf(a, d));
  const [makeDefault, setMakeDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    setSaving(true);
    const body = { ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() || null])), ...(makeDefault ? { isDefault: true } : {}) };
    const { ok, data } = a
      ? await api<{ detail: ClientDetail; warning: string | null }>(`/api/clients/${d.id}/addresses/${a.id}`, "PATCH", body)
      : await api<{ detail: ClientDetail; warning: string | null }>(`/api/clients/${d.id}/addresses`, "POST", body);
    setSaving(false);
    if (!ok) return notify(data.message ?? "Nie udało się zapisać adresu.", true);
    onChanged(data.detail);
    onDone();
    notify(data.warning ? `Zapisano adres. ${data.warning}` : "Zapisano adres dostawy.", !!data.warning);
  }

  async function remove() {
    if (!a) return;
    setSaving(true);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/addresses/${a.id}`, "DELETE");
    setSaving(false);
    if (!ok) return notify(data.message ?? "Nie udało się usunąć adresu.", true);
    onChanged(data.detail);
    onDone();
    notify("Usunięto adres dostawy.");
  }

  return (
    <div className="flex flex-col gap-2 border-t border-[#F0F1F2] py-2.5 first:border-0">
      {EDIT_FIELDS.map((f) => (
        <label key={f.key} className="grid grid-cols-[130px_minmax(0,1fr)] items-start gap-2.5 text-[13px] text-[#5C6166]">
          <span className="pt-2">{f.label}</span>
          {f.area ? (
            <textarea
              rows={2}
              value={v[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              className="w-full resize-y rounded-lg border border-[var(--c-border)] px-3 py-2 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-brand)]"
            />
          ) : (
            <input className={INPUT} value={v[f.key]} placeholder={f.placeholder} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
          )}
        </label>
      ))}
      {a && !a.isDefault && (
        <label className="flex items-center gap-2 pl-[140px] text-[13px] text-[#333333]">
          <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /> adres domyślny (rezerwacje, mapa)
        </label>
      )}
      <p className="pl-[140px] text-[12px] text-[#8A939B]">Po zapisie odległość i czas od bazy liczą się same (OpenStreetMap) — to potrwa kilka sekund.</p>
      <div className="flex items-center justify-between gap-2">
        <span>
          {a &&
            (confirmDelete ? (
              <span className="text-[13px] text-[#5C6166]">
                Usunąć adres?{" "}
                <button type="button" onClick={() => void remove()} disabled={saving} className="text-[#B8612F] hover:underline">
                  tak, usuń
                </button>{" "}
                ·{" "}
                <button type="button" onClick={() => setConfirmDelete(false)} className={LINK}>
                  nie
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-[13px] text-[#767C82] hover:text-[#B8612F]">
                Usuń adres
              </button>
            ))}
        </span>
        <span className="flex gap-2">
          <button type="button" onClick={onDone} className={BTN_OUTLINE}>
            Anuluj
          </button>
          <button type="button" onClick={() => void save()} disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Liczę trasę…" : "Zapisz"}
          </button>
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ widok

function RouteLine({ d, a, onRecalc, busy, canEdit }: { d: ClientDetail; a: DeliveryAddressDto; onRecalc: () => void; busy: boolean; canEdit: boolean }) {
  const route = routeLabel(a.distanceKm, a.routeAuto ? a.durationMin : null);
  const zone = zoneFor(a.distanceKm, d.delivery.zones);
  const parts: ReactNode[] = [];
  if (route)
    parts.push(
      <span key="r">
        {route} od bazy{" "}
        {a.routeAuto ? (
          <span className={`${TAG} border border-[#BFD8EC] bg-[#EAF4FB] text-[#1B6FA8]`} title="Trasa OpenStreetMap (OSRM), bez korków — liczona przy zapisie adresu">
            auto
          </span>
        ) : (
          <span className="text-[#8A939B]">(z wynajmów)</span>
        )}
      </span>,
    );
  if (zone) parts.push(<span key="z">strefa {zone.code}</span>);
  // Adres domyślny: transport ustalony + sugestia w osobnym wierszu (wniosek 28).
  if (!a.isDefault && zone?.priceNet != null) parts.push(<span key="t" title="Podpowiedź ze stawek stref (Ustawienia → Cennik) — nie nadpisuje warunków klienta">transport wg strefy {money(zone.priceNet)}</span>);
  const needs = !a.routeAuto || !a.located;
  return (
    <div className="text-[11.5px] text-[#5C6166]">
      {parts.length ? parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {p}
        </span>
      )) : !a.located ? <span className="text-[#B8612F]">nie znaleziono na mapie — sprawdź adres</span> : null}
      {needs && canEdit && (
        <>
          {parts.length > 0 && " · "}
          <button type="button" onClick={onRecalc} disabled={busy} className="text-[11.5px] text-[#1B6FA8] hover:text-[#0C3450] disabled:opacity-50">
            {busy ? "liczę…" : "policz trasę"}
          </button>
        </>
      )}
    </div>
  );
}

export function DeliverySection({ d, onChanged, notify, isAgent }: Props) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { save, bar } = useTermsSaver(onChanged, notify);
  const addresses = d.delivery.addresses;
  const canEdit = !isAgent;
  const usual = d.cardFacts.usualStartTime ? `dostawa zwykle ${d.cardFacts.usualStartTime.time} (z rezerwacji ${dm(d.cardFacts.usualStartTime.fromAt)})` : null;

  async function recalc(a: DeliveryAddressDto) {
    setBusy(a.id);
    const { ok, data } = await api<{ detail: ClientDetail; warning: string | null }>(`/api/clients/${d.id}/addresses/${a.id}`, "PATCH", { recalc: true });
    setBusy(null);
    if (!ok) return notify(data.message ?? "Nie udało się policzyć trasy.", true);
    onChanged(data.detail);
    notify(data.warning ?? "Przeliczono trasę od bazy.", !!data.warning);
  }

  return (
    <Section title="Paszport dostawy" gap="gap-0">
      {addresses.length === 0 && editing !== "new" && (
        <p className="py-1.5 text-[13px] text-[#5C6166]">
          Brak adresu dostawy.{" "}
          {d.street || d.city ? <>Adres firmy: {[d.street, [d.zip, d.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}.</> : <Missing>uzupełnij</Missing>}
        </p>
      )}
      {addresses.map((a) =>
        editing === a.id ? (
          <AddressEditor key={a.id} d={d} a={a} onDone={() => setEditing(null)} onChanged={onChanged} notify={notify} />
        ) : (
          <div key={a.id} className="border-t border-[#F0F1F2] pb-1 pt-2 first:border-0 first:pt-0.5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0 text-[13px]">
                <b className="font-semibold text-[#0C3450]">{a.label}</b>
                {a.isDefault && <span className="ml-1.5 inline-block bg-[#EAF4FB] px-[7px] py-px text-[11.5px] text-[#0C3450]">domyślny</span>}
                <span className="text-[11.5px] text-[#5C6166]"> · widoczne dla kierowcy</span>
              </div>
              {canEdit && editing === null && (
                <button type="button" onClick={() => setEditing(a.id)} className={LINK}>
                  Edytuj
                </button>
              )}
            </div>
            <div className="text-[13px] text-[#333333]">{a.line || <Missing>uzupełnij adres</Missing>}</div>
            <RouteLine d={d} a={a} canEdit={canEdit} busy={busy === a.id} onRecalc={() => void recalc(a)} />
            {a.isDefault && (
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <TransportFixed d={d} save={save} />
                {bar}
              </div>
            )}
            <div className="mt-1.5">
              <Fld label="Na miejscu">
                <OnSite a={a} usual={a.isDefault ? usual : null} />
              </Fld>
              <Fld label="Uwagi biura">{a.officeNotes ?? <span className="text-[#8A939B]">brak</span>}</Fld>
              <Fld label="Uwagi kierowcy">
                <DriverNotes a={a} />
              </Fld>
            </div>
          </div>
        ),
      )}
      {editing === "new" && <AddressEditor d={d} a={null} onDone={() => setEditing(null)} onChanged={onChanged} notify={notify} />}
      {canEdit && editing === null && (
        <button type="button" onClick={() => setEditing("new")} className="mt-1 self-start border-t border-[#F0F1F2] pt-1.5 text-left text-[13px] text-[#8A939B] hover:text-[#1B6FA8]">
          {addresses.length ? "+ kolejny adres (np. drugi gabinet)" : "+ dodaj adres dostawy"}
        </button>
      )}
    </Section>
  );
}
