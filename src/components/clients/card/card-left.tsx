"use client";

import { useState } from "react";
import Link from "next/link";
import type { ClientDetail } from "@/lib/clients/load";
import { CLINIC_TYPE_LABEL, type ClinicTypeKey, formatNip, formatPhone } from "@/lib/clients/labels";
import { PERSON_ROLE_LABEL, type PersonRole } from "@/lib/clients/profile-fields";
import { monthsLabel } from "@/lib/clients/rhythm";
import { ContactForm, api } from "../client-forms";
import { FieldsEditor, boolInput, dateInput, type FieldDef } from "./fields-editor";
import { LINK, Missing, Quote, Row, Section, dm, dmy, money } from "./kit";
import { isConfirmingSource } from "./sources";

// Lewa kolumna karty (440 px) wg projektu Main.dc.html: Dane firmy, Osoby,
// Paszport dostawy, Profil gabinetu, Zgody i komunikacja, Powiązania
// i aliasy. Każda sekcja edytowana w miejscu (PATCH /api/clients/:id).

type Props = { d: ClientDetail; onChanged: (next: ClientDetail) => void; notify: (text: string, error?: boolean) => void };

const personName = (c: { firstName: string | null; lastName: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(" ").trim();

// Źródła pola: pochodzenie z fieldMeta, a bez niego — skąd pole przyszło.
export function fieldSources(d: ClientDetail, field: string): string[] {
  const m = d.fieldMeta[field];
  if (m) return [m.source];
  if (field === "nip" && d.cardFacts.nipInvoiceCount > 0) return ["fakturownia"];
  if (["name", "street", "zip", "city"].includes(field) && d.hubspotCompanyId) return ["hubspot"];
  if (field === "shortName" && d.aliases.length) return ["kalendarze"];
  return [];
}

function EditLink({ onClick, label = "Edytuj" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className={LINK}>
      {label}
    </button>
  );
}

// ------------------------------------------------------------------ Dane firmy

function CompanySection({ d, onChanged, notify, isAgent }: Props & { isAgent: boolean }) {
  const [edit, setEdit] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const p = d.profile;
  // Źródło tylko przy wypełnionym polu (puste = „[uzupełnij]” bez źródła).
  const filled: Record<string, boolean> = {
    name: !!d.name,
    shortName: !!p.shortName,
    legalForm: !!p.legalForm,
    businessStartDate: !!p.businessStartDate,
    nip: !!d.nip,
    regon: !!p.regon,
    pkd: p.pkd.length > 0,
    street: !!(d.street || d.city),
    vatStatus: !!p.vatStatus,
  };
  const src = (f: string) => (filled[f] === false ? [] : fieldSources(d, f));
  const verified = [...["name", "nip", "regon", "legalForm", "pkd", "street", "vatStatus"].map((f) => d.fieldMeta[f]?.verifiedAt ?? null), p.enrichedAt]
    .filter((x): x is string => !!x)
    .sort()
    .pop();
  const mainPkd = p.pkd.find((x) => x.main) ?? p.pkd[0];
  const otherPkd = p.pkd.filter((x) => x !== mainPkd).map((x) => x.code);
  const fields: FieldDef[] = [
    { key: "name", label: "Pełna nazwa" },
    { key: "shortName", label: "Nazwa robocza", placeholder: "tak jak w kalendarzach, np. MiWiNi" },
    { key: "legalForm", label: "Forma", placeholder: "JDG, sp. z o.o., s.c." },
    { key: "businessStartDate", label: "Działalność od", kind: "date" },
    { key: "nip", label: "NIP" },
    { key: "regon", label: "REGON" },
    { key: "pkd", label: "PKD", kind: "list", placeholder: "96.02.Z zabiegi kosmetyczne\n85.59.B" },
    { key: "street", label: "Ulica i numer" },
    { key: "zip", label: "Kod" },
    { key: "city", label: "Miasto" },
    { key: "vatStatus", label: "Status VAT", kind: "select", options: ["Czynny", "Zwolniony", "Niezarejestrowany"].map((x) => ({ value: x, label: x })) },
    { key: "bankAccounts", label: "Rachunki", kind: "list" },
  ];
  const initial = {
    name: d.name,
    shortName: p.shortName ?? "",
    legalForm: p.legalForm ?? "",
    businessStartDate: dateInput(p.businessStartDate),
    nip: d.nip ?? "",
    regon: p.regon ?? "",
    pkd: p.pkd.map((x) => `${x.code}${x.name ? ` ${x.name}` : ""}`).join("\n"),
    street: d.street ?? "",
    zip: d.zip ?? "",
    city: d.city ?? "",
    vatStatus: p.vatStatus ?? "",
    bankAccounts: p.bankAccounts.join("\n"),
  };

  async function enrich() {
    setEnriching(true);
    const { ok, data } = await api<{ detail: ClientDetail; message?: string; updated?: string[] }>(`/api/clients/${d.id}/enrich`, "POST");
    setEnriching(false);
    if (!ok) return notify(data.message ?? "Nie udało się pobrać danych po NIP.", true);
    onChanged(data.detail);
    notify(data.updated?.length ? `Uzupełniono z rejestrów: ${data.updated.join(", ")}.` : "Rejestry nie zwróciły nowych danych (pola zmienione ręcznie zostają).");
  }

  const nipSrc = d.cardFacts.nipInvoiceCount > 0 ? [`${d.cardFacts.nipInvoiceCount} FV`] : src("nip");
  return (
    <Section title="Dane firmy" action={!edit && <EditLink onClick={() => setEdit(true)} />}>
      {edit ? (
        <FieldsEditor
          clientId={d.id}
          fields={fields}
          initial={initial}
          onCancel={() => setEdit(false)}
          onSaved={(n) => {
            setEdit(false);
            onChanged(n);
            notify("Zapisano dane firmy.");
          }}
        />
      ) : (
        <>
          <Row label="Pełna nazwa" labelWidth={124} src={src("name")}>
            {d.name}
          </Row>
          <Row label="Nazwa robocza" labelWidth={124} src={src("shortName")}>
            {p.shortName ?? <Missing>uzupełnij</Missing>}
          </Row>
          <Row label="Forma" labelWidth={124} src={src(d.fieldMeta.legalForm ? "legalForm" : "businessStartDate")}>
            {p.legalForm || p.businessStartDate ? [p.legalForm, p.businessStartDate ? `od ${dmy(p.businessStartDate)}` : null].filter(Boolean).join(" · ") : <Missing>do sprawdzenia</Missing>}
          </Row>
          <Row label="NIP" labelWidth={124} src={nipSrc}>
            {d.nip ? formatNip(d.nip) : <Missing>brak</Missing>}
          </Row>
          <Row label="REGON" labelWidth={124} src={src("regon")}>
            {p.regon ?? <Missing>uzupełnij po NIP</Missing>}
          </Row>
          <Row label="PKD" labelWidth={124} src={src("pkd")}>
            {mainPkd ? (
              <span title={otherPkd.length ? `także: ${otherPkd.join(", ")}` : undefined}>
                {mainPkd.code}
                {mainPkd.name ? ` ${mainPkd.name}` : ""}
                {otherPkd.length ? <span className="text-[#767C82]"> (+{otherPkd.length})</span> : null}
              </span>
            ) : (
              <Missing>do sprawdzenia</Missing>
            )}
          </Row>
          <Row label="Adres" labelWidth={124} src={src("street")}>
            {d.street || d.city ? [d.street, [d.zip, d.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : <Missing>brak adresu</Missing>}
          </Row>
          <Row label="Status VAT" labelWidth={124} src={src("vatStatus")}>
            {p.vatStatus ? `${p.vatStatus}${p.bankAccounts.length ? ` · ${p.bankAccounts.length} rach.` : ""}` : <Missing>do sprawdzenia</Missing>}
          </Row>
          <div className="flex flex-wrap gap-x-5 pt-3 text-[14px] text-[#767C82]">
            {verified && <span>zweryfikowano {dmy(verified)}</span>}
            {!isAgent && d.nip && (
              <button type="button" onClick={() => void enrich()} disabled={enriching} className={LINK} title="Biała lista MF i CEIDG po NIP — pola zmienione ręcznie zostają">
                {enriching ? "Pobieranie z rejestrów…" : "Uzupełnij po NIP (Biała lista, CEIDG)"}
              </button>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ Osoby

function PeopleSection({ d, onChanged, notify }: Props) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const confirmed = (c: ClientDetail["contacts"][number], field: string) => !!c.fieldMeta[field] && isConfirmingSource(c.fieldMeta[field].source);
  return (
    <Section
      title="Osoby"
      gap="gap-3.5"
      action={
        editing === null && (
          <button type="button" onClick={() => setEditing("new")} className={LINK}>
            + dodaj osobę
          </button>
        )
      }
    >
      {editing === "new" && (
        <ContactForm
          clientId={d.id}
          contact={null}
          onCancel={() => setEditing(null)}
          onSaved={(n) => {
            setEditing(null);
            onChanged(n);
            notify("Dodano osobę.");
          }}
        />
      )}
      {d.contacts.length === 0 && editing !== "new" && <p className="text-[15px] text-[#5C6166]">Brak osób kontaktowych.</p>}
      {d.contacts.map((c) => {
        if (editing === c.id)
          return (
            <ContactForm
              key={c.id}
              clientId={d.id}
              contact={c}
              onCancel={() => setEditing(null)}
              onSaved={(n) => {
                setEditing(null);
                onChanged(n);
                notify("Zapisano osobę.");
              }}
            />
          );
        const roles = [...c.roles.map((r) => PERSON_ROLE_LABEL[r as PersonRole] ?? r), ...(!c.roles.length && c.role ? [c.role] : [])];
        const extra = [c.salutation ? `Zwrot „${c.salutation}”` : null, c.preferredChannel, c.roles.includes("invoices") ? "faktury mailem" : null].filter(Boolean).join(" · ");
        const trained = c.trainedOn.length || c.roles.includes("owner") || c.roles.includes("cosmetologist");
        if (c.isPrimary)
          return (
            <div key={c.id} className="flex flex-col gap-2 border-l-[3px] border-[#2F7A68] bg-[#EEF6F2] px-[22px] py-5">
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#2F7A68]">{["Osoba główna", ...roles].join(" · ")}</div>
              <button type="button" onClick={() => setEditing(c.id)} className="card-display text-left text-[21px] font-medium text-[#1F5E4F] hover:underline" title="Edytuj osobę">
                {personName(c) || c.email || "Osoba bez nazwy"}
              </button>
              {c.phone && (
                <div className="text-[16px] tabular-nums text-[#333333]">
                  <a href={`tel:${c.phone}`} className="text-[#333333] hover:text-[#1B6FA8]">
                    {formatPhone(c.phone)}
                  </a>{" "}
                  {confirmed(c, "phone") && <span className="text-[13px] font-semibold text-[#2F7A68]">✓ potwierdzony</span>}
                </div>
              )}
              {c.phone2 && (
                <div className="text-[16px] tabular-nums text-[#333333]">
                  {formatPhone(c.phone2)} <span className="text-[13px] text-[#767C82]">{c.phone2Label ?? "drugi"}</span>
                </div>
              )}
              {c.email && (
                <div className="break-all text-[16px] text-[#333333]">
                  {c.email} {(c.roles.includes("invoices") || c.email === d.profile.invoiceEmail) && <span className="text-[13px] font-semibold text-[#2F7A68]">✓ faktury</span>}
                </div>
              )}
              {extra && <div className="text-[15px] text-[#4A4A4A]">{extra}</div>}
              {trained && (
                <div className="text-[15px] text-[#4A4A4A]">
                  Przeszkolona: {c.trainedOn.length ? c.trainedOn.map((t) => `${t.device}${t.date ? ` · ${dmy(t.date)}` : ""}`).join(", ") : <Missing>data</Missing>}
                </div>
              )}
            </div>
          );
        return (
          <div key={c.id} className="flex flex-col gap-1 border border-dashed border-[#C3C4C7] px-[22px] py-4">
            <div className="flex items-baseline justify-between gap-3">
              <button type="button" onClick={() => setEditing(c.id)} className="text-left text-[17px] font-medium text-[#1B6FA8] hover:underline" title="Edytuj osobę">
                {personName(c) || c.email || c.phone || "Osoba bez nazwy"}
              </button>
              {roles.length ? (
                <span className="text-right text-[12px] uppercase tracking-[0.12em] text-[#5C6166]">{roles.join(" · ")}</span>
              ) : (
                <span className="text-[12px] uppercase tracking-[0.12em] text-[#B8612F]">do potwierdzenia</span>
              )}
            </div>
            {c.phone && <div className="text-[16px] tabular-nums text-[#333333]">{formatPhone(c.phone)}</div>}
            {c.email && <div className="break-all text-[16px] text-[#333333]">{c.email}</div>}
            {extra && <div className="text-[14px] text-[#767C82]">{extra}</div>}
          </div>
        );
      })}
    </Section>
  );
}

// ------------------------------------------------------------------ Paszport dostawy

function DeliverySection({ d, onChanged, notify, isAgent }: Props & { isAgent: boolean }) {
  const [edit, setEdit] = useState(false);
  const p = d.profile;
  const n = p.deliveryNotes;
  const company = [d.street, d.city].filter(Boolean).join(", ");
  const fields: FieldDef[] = [
    { key: "deliveryAddress", label: "Adres dostawy", placeholder: company ? `puste = adres firmy (${company})` : undefined },
    { key: "deliveryNotes.entrance", label: "Wejście" },
    { key: "deliveryNotes.floor", label: "Piętro" },
    { key: "deliveryNotes.parking", label: "Parking" },
    { key: "deliveryNotes.power", label: "Zasilanie", placeholder: "gniazdo, bezpiecznik" },
    { key: "deliveryNotes.receiver", label: "Kto odbiera" },
    ...(isAgent
      ? []
      : ([
          { key: "transportPriceNet", label: "Transport netto (zł)", kind: "number" },
          { key: "distanceKm", label: "Odległość (km)", kind: "number" },
        ] as FieldDef[])),
  ];
  const initial = {
    deliveryAddress: p.deliveryAddress ?? "",
    "deliveryNotes.entrance": n?.entrance ?? "",
    "deliveryNotes.floor": n?.floor ?? "",
    "deliveryNotes.parking": n?.parking ?? "",
    "deliveryNotes.power": n?.power ?? "",
    "deliveryNotes.receiver": n?.receiver ?? "",
    transportPriceNet: d.transportPriceNet ? String(Number(d.transportPriceNet)) : "",
    distanceKm: d.distanceKm ? String(Number(d.distanceKm)) : "",
  };
  const next = d.overview.nextRental;
  const nextDay = next ? dm(next.startsAt) : null;
  return (
    <Section title="Paszport dostawy" sub="Dla kierowcy i instalatora." action={!edit && <EditLink onClick={() => setEdit(true)} />}>
      {edit ? (
        <FieldsEditor
          clientId={d.id}
          fields={fields}
          initial={initial}
          onCancel={() => setEdit(false)}
          onSaved={(x) => {
            setEdit(false);
            onChanged(x);
            notify("Zapisano paszport dostawy.");
          }}
        />
      ) : (
        <>
          <Row label="Adres dostawy">{p.deliveryAddress ?? (company || <Missing>uzupełnij</Missing>)}</Row>
          <Row label="Godzina">
            {d.cardFacts.usualStartTime ? `${d.cardFacts.usualStartTime.time} (z rezerwacji ${dm(d.cardFacts.usualStartTime.fromAt)})` : <Missing>brak rezerwacji z godziną</Missing>}
          </Row>
          <Row label="Odległość">{d.distanceKm ? `${Number(d.distanceKm).toLocaleString("pl-PL")} km` : <Missing>auto z mapy</Missing>}</Row>
          <Row label="Transport">
            {d.transportPriceNet && Number(d.transportPriceNet) > 0 ? `${money(Number(d.transportPriceNet))} netto` : <Missing>uzupełnij w warunkach</Missing>}
          </Row>
          <Row label="Wejście / piętro">{n?.entrance || n?.floor ? [n.entrance, n.floor].filter(Boolean).join(" · ") : <Missing>uzupełnia kierowca{nextDay ? ` ${nextDay}` : ""}</Missing>}</Row>
          <Row label="Parking">{n?.parking ?? <Missing>uzupełnia kierowca</Missing>}</Row>
          <Row label="Zasilanie">{n?.power ?? <Missing>uzupełnia instalator</Missing>}</Row>
          {n?.receiver && <Row label="Kto odbiera">{n.receiver}</Row>}
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ Profil gabinetu

const LINK_LABEL: Record<string, string> = { www: "WWW", instagram: "Instagram", facebook: "Facebook", booksy: "Booksy", fresha: "Fresha" };

function ProfileSection({ d, onChanged, notify }: Props) {
  const [edit, setEdit] = useState(false);
  const p = d.profile;
  const links = p.links
    ? Object.entries(p.links)
        .filter(([, v]) => v)
        .map(([k, v]) => ({ k, v: v as string }))
    : [];
  const fields: FieldDef[] = [
    {
      key: "clinicType",
      label: "Typ",
      kind: "select",
      options: (Object.keys(CLINIC_TYPE_LABEL) as ClinicTypeKey[]).map((k) => ({ value: k, label: CLINIC_TYPE_LABEL[k] })),
    },
    { key: "services", label: "Usługi", kind: "list" },
    { key: "openingHours", label: "Godziny", placeholder: "pn–pt 9–20 · sob 9–15" },
    { key: "links.www", label: "WWW" },
    { key: "links.instagram", label: "Instagram" },
    { key: "links.facebook", label: "Facebook" },
    { key: "links.booksy", label: "Booksy" },
    { key: "links.fresha", label: "Fresha" },
    { key: "ownDevices", label: "Własne urządzenia", kind: "textarea" },
    { key: "seasonality", label: "Sezonowość", placeholder: "depilacja X–VI, przerwa VII–VIII" },
  ];
  const initial = {
    clinicType: d.clinicType ?? "",
    services: p.services.join("\n"),
    openingHours: p.openingHours ?? "",
    "links.www": p.links?.www ?? "",
    "links.instagram": p.links?.instagram ?? "",
    "links.facebook": p.links?.facebook ?? "",
    "links.booksy": p.links?.booksy ?? "",
    "links.fresha": p.links?.fresha ?? "",
    ownDevices: p.ownDevices ?? "",
    seasonality: p.seasonality ?? "",
  };
  const href = (k: string, v: string) =>
    /^https?:\/\//.test(v) ? v : k === "instagram" ? `https://instagram.com/${v.replace(/^@/, "")}` : k === "www" ? `https://${v}` : null;
  return (
    <Section title="Profil gabinetu" action={!edit && <EditLink onClick={() => setEdit(true)} />}>
      {edit ? (
        <FieldsEditor
          clientId={d.id}
          fields={fields}
          initial={initial}
          onCancel={() => setEdit(false)}
          onSaved={(x) => {
            setEdit(false);
            onChanged(x);
            notify("Zapisano profil gabinetu.");
          }}
        />
      ) : (
        <>
          <Row label="Typ">{d.clinicType ? CLINIC_TYPE_LABEL[d.clinicType].toLowerCase() : <Missing>uzupełnij</Missing>}</Row>
          <Row label="Usługi">{p.services.length ? p.services.join(", ") : <Missing>do sprawdzenia</Missing>}</Row>
          <Row label="Godziny">{p.openingHours ?? <Missing>do sprawdzenia</Missing>}</Row>
          <Row label="Online">
            {links.length ? (
              links.map(({ k, v }, i) => {
                const url = href(k, v);
                const text = LINK_LABEL[k];
                return (
                  <span key={k}>
                    {i > 0 && " · "}
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="text-[#1B6FA8] hover:text-[#0C3450]">
                        {text}
                      </a>
                    ) : (
                      text
                    )}
                  </span>
                );
              })
            ) : (
              <Missing>brak</Missing>
            )}
          </Row>
          <Row label="Własne urządzenia">{p.ownDevices ?? <Missing>zapytać</Missing>}</Row>
          <Row label="Sezonowość">
            {p.seasonality ?? (d.rhythm.seasonalBreak.length ? `przerwa ${monthsLabel(d.rhythm.seasonalBreak)} (z historii wynajmów)` : <Missing>brak danych</Missing>)}
          </Row>
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ Zgody i komunikacja

function ConsentsSection({ d, onChanged, notify }: Props) {
  const [edit, setEdit] = useState(false);
  const p = d.profile;
  const lastSms = [d.cardFacts.lastSmsAt, ...d.history.filter((h) => h.kind === "message" && h.channel === "SMS" && !h.failed).map((h) => h.at)]
    .filter((x): x is string => !!x)
    .sort()
    .pop();
  const mc = p.marketingConsent;
  const fields: FieldDef[] = [
    { key: "smsReminders", label: "SMS z przypomnieniem", kind: "bool" },
    { key: "marketingConsent.email", label: "Zgoda: e-mail", kind: "bool" },
    { key: "marketingConsent.sms", label: "Zgoda: SMS", kind: "bool" },
    { key: "marketingConsent.date", label: "Data zgody", kind: "date" },
    { key: "marketingConsent.source", label: "Źródło zgody", placeholder: "formularz, rozmowa…" },
    { key: "googleReview.askedAt", label: "Prośba o opinię", kind: "date" },
    { key: "googleReview.given", label: "Opinia wystawiona", kind: "bool" },
  ];
  const initial = {
    smsReminders: boolInput(p.smsReminders),
    "marketingConsent.email": boolInput(mc?.email),
    "marketingConsent.sms": boolInput(mc?.sms),
    "marketingConsent.date": dateInput(mc?.date),
    "marketingConsent.source": mc?.source ?? "",
    "googleReview.askedAt": dateInput(p.googleReview?.askedAt),
    "googleReview.given": boolInput(p.googleReview?.given),
  };
  const smsOn = p.smsReminders === true || (p.smsReminders === null && !!lastSms);
  const smsText = p.smsReminders === false ? "nie" : smsOn ? `✓ tak${lastSms ? ` (ostatni ${dmy(lastSms)})` : ""}` : null;
  const consent = mc && (mc.email !== null || mc.sms !== null) ? [mc.email !== null ? `e-mail: ${mc.email ? "tak" : "nie"}` : null, mc.sms !== null ? `SMS: ${mc.sms ? "tak" : "nie"}` : null, mc.date ? dmy(mc.date) : null, mc.source].filter(Boolean).join(" · ") : null;
  return (
    <Section title="Zgody i komunikacja" action={!edit && <EditLink onClick={() => setEdit(true)} />}>
      {edit ? (
        <FieldsEditor
          clientId={d.id}
          fields={fields}
          initial={initial}
          onCancel={() => setEdit(false)}
          onSaved={(x) => {
            setEdit(false);
            onChanged(x);
            notify("Zapisano zgody.");
          }}
        />
      ) : (
        <>
          <Row label="SMS-przypomnienia" labelWidth={190} valueClass={smsOn ? "font-semibold text-[#2F7A68]" : "text-[#333333]"}>
            {smsText ?? <Missing>nie ustalono</Missing>}
          </Row>
          <Row label="Mailing / oferty" labelWidth={190}>
            {consent ?? <Missing>brak zapisanej zgody</Missing>}
          </Row>
          <Row label="Nie kontaktować" labelWidth={190}>
            {d.statusOverride === "NIE_KONTAKTOWAC" ? <span className="text-[#B8612F]">tak</span> : "nie"}
          </Row>
          <Row label="Ostatni kontakt" labelWidth={190}>
            {d.overview.lastContact ? `${dmy(d.overview.lastContact.at)} · ${d.overview.lastContact.label}` : <Missing>brak</Missing>}
          </Row>
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ Powiązania i aliasy

function LinksSection({
  d,
  isAdmin,
  isAgent,
  pendingProposals,
  onDialog,
}: {
  d: ClientDetail;
  isAdmin: boolean;
  isAgent: boolean;
  pendingProposals: number;
  onDialog: (k: "merge" | "split" | "archive") => void;
}) {
  const manual = d.lineage.some((l) => l.kind === "SPLIT_FROM");
  const other = (l: ClientDetail["lineage"][number]) =>
    l.otherId ? (
      <Link href={`/klienci/${l.otherId}`} className="text-[#1B6FA8] underline decoration-[#82B7DA] hover:text-[#0C3450]">
        „{l.otherName}”
      </Link>
    ) : (
      `„${l.otherName}”`
    );
  return (
    <Section title="Powiązania i aliasy" gap="gap-3">
      <div className="text-[15px] text-[#5C6166]">
        {d.aliases.length ? "Tytuły z kalendarzy, które same trafiają do tej karty:" : "Brak aliasów z kalendarzy — przypisz wydarzenia w Klienci → Dopasowania."}
      </div>
      {d.aliases.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {d.aliases.map((a) => (
            <span key={a} className="bg-[#EAF4FB] px-2.5 py-1 text-[14px] text-[#1B6FA8]">
              {a}
            </span>
          ))}
        </div>
      )}
      {d.lineage.map((l, i) => (
        <div key={i} className="mt-1.5">
          <Quote>
            {l.kind === "SPLIT_FROM" && (
              <>
                Wydzielona {dmy(l.at)} z rekordu {other(l)}. Przypisanie ręczne: synchronizacja go nie zmienia.
              </>
            )}
            {l.kind === "SPLIT_TO" && (
              <>
                {dmy(l.at)} wydzielono z tej karty klienta {other(l)}.
              </>
            )}
            {l.kind === "MERGED_FROM" && (
              <>
                {dmy(l.at)} scalono tu duplikat „{l.otherName}” (w archiwum).
              </>
            )}
          </Quote>
        </div>
      ))}
      {!manual && d.hubspotCompanyId && <div className="text-[15px] text-[#5C6166]">Rekord z HubSpota (firma {d.hubspotCompanyId}).</div>}
      {!d.archive && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1">
          <button type="button" onClick={() => onDialog("merge")} className={LINK}>
            Scal duplikat
          </button>
          {!isAgent && d.contacts.length > 1 && (
            <button type="button" onClick={() => onDialog("split")} className={LINK}>
              Wydziel osoby
            </button>
          )}
          {pendingProposals > 0 && (
            <Link href={`/propozycje?klient=${d.id}`} className={LINK}>
              {pendingProposals} {pendingProposals === 1 ? "propozycja zmian" : "propozycje zmian"} do akceptacji
            </Link>
          )}
          {d.hubspotUrl && (
            <a href={d.hubspotUrl} target="_blank" rel="noreferrer" className={LINK}>
              Otwórz w HubSpot
            </a>
          )}
          {isAdmin && (
            <button type="button" onClick={() => onDialog("archive")} className="text-[15px] text-[#767C82] hover:text-[#B8612F]">
              Archiwizuj
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

export function CardLeft(props: Props & { isAdmin: boolean; isAgent: boolean; pendingProposals: number; onDialog: (k: "merge" | "split" | "archive") => void }) {
  return (
    <div className="flex w-full shrink-0 flex-col gap-10 xl:w-[440px]">
      <CompanySection {...props} />
      <PeopleSection {...props} />
      <DeliverySection {...props} />
      <ProfileSection {...props} />
      <ConsentsSection {...props} />
      <LinksSection d={props.d} isAdmin={props.isAdmin} isAgent={props.isAgent} pendingProposals={props.pendingProposals} onDialog={props.onDialog} />
    </div>
  );
}
