"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { ClientDetail } from "@/lib/clients/load";
import { CLINIC_TYPE_LABEL, DEVICE_INTEREST_LABEL, SOURCE_LABEL, type ClinicTypeKey, formatNip, formatPhone } from "@/lib/clients/labels";
import { REGION_LABEL, computeRegion } from "@/lib/clients/region";
import { PERSON_ROLE_LABEL, type PersonRole } from "@/lib/clients/profile-fields";
import { monthsLabel } from "@/lib/clients/rhythm";
import { ContactForm, api } from "../client-forms";
import { FieldsEditor, boolInput, dateInput, type FieldDef } from "./fields-editor";
import { LINK, Missing, Quote, Row, Section, dm, dmy } from "./kit";
import { isConfirmingSource } from "./sources";
import { DeliverySection } from "./delivery-passport";
import { TermsBlock } from "./card-terms";

// Lewa kolumna karty wg karta-kierunek.html (etap 1, 27.09.2026): Dane firmy
// (dane do faktury zwinięte), Osoby, Paszport dostawy, a Profil gabinetu,
// Zgody i komunikacja oraz Powiązania i aliasy — zwinięte do jednej linii.
// Każda sekcja edytowana w miejscu (PATCH /api/clients/:id).

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
  const fields: FieldDef[] = [
    { key: "name", label: "Pełna nazwa" },
    { key: "shortName", label: "Nazwa robocza", placeholder: "tak jak w kalendarzach, np. MiWiNi" },
    { key: "nip", label: "NIP" },
    { key: "street", label: "Ulica i numer" },
    { key: "zip", label: "Kod" },
    { key: "city", label: "Miasto" },
    { key: "regon", label: "REGON" },
    { key: "legalForm", label: "Forma prawna", placeholder: "JDG, sp. z o.o., s.c." },
    { key: "vatStatus", label: "Status VAT", kind: "select", options: ["Czynny", "Zwolniony", "Niezarejestrowany"].map((x) => ({ value: x, label: x })) },
    { key: "invoiceEmail", label: "E-mail do faktur" },
    { key: "bankAccounts", label: "Rachunki", kind: "list" },
    { key: "invoiceBuyerName", label: "Nabywca faktury (inny niż gabinet)", placeholder: "puste = faktura na gabinet" },
    { key: "invoiceBuyerNip", label: "NIP nabywcy" },
  ];
  const initial = {
    name: d.name,
    shortName: p.shortName ?? "",
    nip: d.nip ?? "",
    street: d.street ?? "",
    zip: d.zip ?? "",
    city: d.city ?? "",
    regon: p.regon ?? "",
    legalForm: p.legalForm ?? "",
    vatStatus: p.vatStatus ?? "",
    invoiceEmail: p.invoiceEmail ?? "",
    bankAccounts: p.bankAccounts.join("\n"),
    invoiceBuyerName: p.invoiceBuyerName ?? "",
    invoiceBuyerNip: p.invoiceBuyerNip ? (formatNip(p.invoiceBuyerNip) ?? p.invoiceBuyerNip) : "",
  };
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const geo = d.delivery.addresses.find((a) => a.isDefault);
  const region = d.city || d.zip ? REGION_LABEL[computeRegion(d.zip, d.city, geo && { state: geo.geoState, county: geo.geoCounty })] : null;

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
          <Row label="Pełna nazwa" labelWidth={110} src={src("name")}>
            {d.name}
          </Row>
          <Row label="Nazwa robocza" labelWidth={110} src={src("shortName")}>
            {p.shortName ?? <Missing>uzupełnij</Missing>}
          </Row>
          <Row label="NIP" labelWidth={110} src={nipSrc}>
            {d.nip ? formatNip(d.nip) : <Missing>brak</Missing>}
          </Row>
          <Row label="Adres firmy" labelWidth={110} src={src("street")}>
            {d.street || d.city ? (
              <>
                {[d.street, [d.zip, d.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
                {region && <span className="text-[#767C82]"> · {region.toLowerCase()}</span>}
              </>
            ) : (
              <Missing>brak adresu</Missing>
            )}
          </Row>
          {/* Dane do faktury — zwinięte; rozwinięcie w miejscu. */}
          <div className="grid items-baseline gap-2.5 border-b border-[#F0F1F2] py-[5px] last:border-0" style={{ gridTemplateColumns: "110px minmax(0,1fr)" }}>
            <button type="button" onClick={() => setInvoiceOpen((v) => !v)} aria-expanded={invoiceOpen} className="text-left text-[10.5px] uppercase tracking-[0.12em] text-[#5C6166] hover:text-[#1B6FA8]">
              Dane do faktury {invoiceOpen ? "▴" : "▾"}
            </button>
            {invoiceOpen ? (
              <span className="text-[12px] text-[#767C82]">poniżej</span>
            ) : (
              <button type="button" onClick={() => setInvoiceOpen(true)} className="text-left text-[12.5px] text-[#8A939B] hover:text-[#1B6FA8]">
                {[
                  p.regon ? "REGON" : null,
                  p.legalForm ?? null,
                  p.vatStatus ? `VAT: ${p.vatStatus.toLowerCase()}` : null,
                  p.invoiceEmail ? "e-mail do faktur" : null,
                  p.bankAccounts.length ? `${p.bankAccounts.length} rach.` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "REGON · forma · status VAT · e-mail do faktur · rachunek"}
                {p.invoiceBuyerName && <b className="font-semibold text-[#1B6FA8]"> · nabywca: {p.invoiceBuyerName}</b>}
              </button>
            )}
          </div>
          {invoiceOpen && (
            <div className="border-l-2 border-[#EAF4FB] pl-2">
              <Row label="REGON" labelWidth={102} src={src("regon")}>
                {p.regon ?? <Missing>uzupełnij po NIP</Missing>}
              </Row>
              <Row label="Forma prawna" labelWidth={102} src={src("legalForm")}>
                {p.legalForm ?? <Missing>do sprawdzenia</Missing>}
              </Row>
              <Row label="Status VAT" labelWidth={102} src={src("vatStatus")}>
                {p.vatStatus ?? <Missing>do sprawdzenia</Missing>}
              </Row>
              <Row label="E-mail do faktur" labelWidth={102}>
                {p.invoiceEmail ?? <Missing>brak</Missing>}
              </Row>
              <Row label="Rachunek" labelWidth={102} src={p.bankAccounts.length ? src("bankAccounts") : undefined}>
                {p.bankAccounts.length ? p.bankAccounts.map((a) => a.replace(/(\d{2})(?=\d)/g, "$1 ").trim()).join(", ") : <span className="text-[#767C82]">— (uzupełni się z wyciągu)</span>}
              </Row>
              <Row label="Nabywca faktury" labelWidth={102}>
                {p.invoiceBuyerName ? (
                  <>
                    {p.invoiceBuyerName}
                    {p.invoiceBuyerNip && <span className="text-[#767C82]"> · NIP {formatNip(p.invoiceBuyerNip)}</span>}
                  </>
                ) : (
                  <span className="text-[#767C82]">ten sam co gabinet</span>
                )}
              </Row>
              {p.frameAgreement && (
                <Row label="Umowa ramowa" labelWidth={102}>
                  {p.frameAgreement.name}
                  {p.frameAgreement.signedAt ? ` · ${dmy(p.frameAgreement.signedAt)}` : ""}
                </Row>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-x-5 pt-3 text-[12.5px] text-[#767C82]">
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
      {d.contacts.length === 0 && editing !== "new" && <p className="text-[13px] text-[#5C6166]">Brak osób kontaktowych.</p>}
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
        // Jedna „rola”: role z listy + opisowa (gdy nie powtarza tej z listy).
        const listed = c.roles.map((r) => PERSON_ROLE_LABEL[r as PersonRole] ?? r);
        const roles = [...listed, ...(c.role && !listed.some((x) => x.toLowerCase().startsWith(c.role!.toLowerCase().slice(0, 5))) ? [c.role] : [])];
        const extra = [c.salutation ? `Zwrot „${c.salutation}”` : null, c.preferredChannel, c.roles.includes("invoices") ? "faktury mailem" : null].filter(Boolean).join(" · ");
        if (c.isPrimary) {
          const sms = d.profile.smsReminders === true ? "tak" : d.profile.smsReminders === false ? "nie" : null;
          const details = [
            c.salutation ? `forma: ${c.salutation}` : null,
            c.preferredChannel ? `kanał: ${c.preferredChannel}` : null,
            sms ? `przypomnienia SMS: ${sms}` : null,
            c.trainedOn.length ? `przeszkolenia: ${c.trainedOn.map((t) => `${t.device}${t.date ? ` ${dmy(t.date)}` : ""}`).join(", ")}` : null,
          ].filter(Boolean);
          return (
            <div key={c.id} className="flex flex-col gap-0.5 border-l-[3px] border-[#2F7A68] bg-[#EEF6F2] px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#2F7A68]">Osoba główna</div>
              <div>
                <button type="button" onClick={() => setEditing(c.id)} className="text-left text-[14px] font-semibold text-[#0C3450] hover:underline" title="Edytuj osobę">
                  {personName(c) || c.email || "Osoba bez nazwy"}
                </button>
                {roles.length > 0 && <span className="text-[13px] text-[#3A3A3A]"> · {roles.join(", ")}</span>}
              </div>
              {(c.phone || c.email) && (
                <div className="break-all text-[13px] tabular-nums text-[#333333]">
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="text-[#333333] hover:text-[#1B6FA8]">
                      {formatPhone(c.phone)}
                    </a>
                  )}
                  {c.phone && confirmed(c, "phone") && <span className="text-[11px] font-semibold text-[#2F7A68]"> ✓</span>}
                  {c.phone && c.email && " · "}
                  {c.email}
                  {c.email && (c.roles.includes("invoices") || c.email === d.profile.invoiceEmail) && <span className="text-[11px] font-semibold text-[#2F7A68]"> ✓ faktury</span>}
                </div>
              )}
              {c.phone2 && (
                <div className="text-[13px] tabular-nums text-[#333333]">
                  {formatPhone(c.phone2)} <span className="text-[11px] text-[#767C82]">{c.phone2Label ?? "drugi"}</span>
                </div>
              )}
              <div className="mt-0.5 text-[11.5px] leading-snug text-[#5C6166]">
                {details.length ? details.join(" · ") : <span>forma zwracania · kanał · przeszkolenia — <Missing>uzupełnij</Missing></span>}
              </div>
            </div>
          );
        }
        return (
          <div key={c.id} className="flex flex-col gap-0.5 border border-dashed border-[#C3C4C7] px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <button type="button" onClick={() => setEditing(c.id)} className="text-left text-[14px] font-medium text-[#1B6FA8] hover:underline" title="Edytuj osobę">
                {personName(c) || c.email || c.phone || "Osoba bez nazwy"}
              </button>
              {roles.length ? (
                <span className="text-right text-[11px] uppercase tracking-[0.12em] text-[#5C6166]">{roles.join(" · ")}</span>
              ) : (
                <span className="text-[11px] uppercase tracking-[0.12em] text-[#B8612F]">do potwierdzenia</span>
              )}
            </div>
            {c.phone && <div className="text-[13px] tabular-nums text-[#333333]">{formatPhone(c.phone)}</div>}
            {c.email && <div className="break-all text-[13px] text-[#333333]">{c.email}</div>}
            {extra && <div className="text-[12.5px] text-[#767C82]">{extra}</div>}
          </div>
        );
      })}
    </Section>
  );
}

// ------------------------------------------------------------------ Profil gabinetu

const LINK_LABEL: Record<string, string> = { www: "WWW", instagram: "Instagram", facebook: "Facebook", booksy: "Booksy", fresha: "Fresha" };

function ProfileSection({ d, onChanged, notify, headless }: Props & { headless?: boolean }) {
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
    <Section title="Profil gabinetu" headless={headless} action={!edit && <EditLink onClick={() => setEdit(true)} />}>
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
          <Row label="Zainteresowania">{d.deviceInterests.length ? d.deviceInterests.map((k) => DEVICE_INTEREST_LABEL[k]).join(", ") : <Missing>brak</Missing>}</Row>
          <Row label="Źródło">{d.source ? SOURCE_LABEL[d.source] : <Missing>nieznane</Missing>}</Row>
          <Row label="Sezonowość">
            {p.seasonality ?? (d.rhythm.seasonalBreak.length ? `przerwa ${monthsLabel(d.rhythm.seasonalBreak)} (z historii wynajmów)` : <Missing>brak danych</Missing>)}
          </Row>
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ Zgody i komunikacja

function ConsentsSection({ d, onChanged, notify, headless }: Props & { headless?: boolean }) {
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
    <Section title="Zgody i komunikacja" headless={headless} action={!edit && <EditLink onClick={() => setEdit(true)} />}>
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
          <Row label="SMS-przypomnienia" labelWidth={150} valueClass={smsOn ? "font-semibold text-[#2F7A68]" : "text-[#333333]"}>
            {smsText ?? <Missing>nie ustalono</Missing>}
          </Row>
          <Row label="Mailing / oferty" labelWidth={150}>
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
  headless,
}: {
  headless?: boolean;
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
    <Section title="Powiązania i aliasy" gap="gap-3" headless={headless}>
      <div className="text-[13px] text-[#5C6166]">
        {d.aliases.length ? "Tytuły z kalendarzy, które same trafiają do tej karty:" : "Brak aliasów z kalendarzy — przypisz wydarzenia w Klienci → Dopasowania."}
      </div>
      {d.aliases.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {d.aliases.map((a) => (
            <span key={a} className="bg-[#EAF4FB] px-2.5 py-1 text-[12.5px] text-[#1B6FA8]">
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
      {!manual && d.hubspotCompanyId && <div className="text-[13px] text-[#5C6166]">Rekord z HubSpota (firma {d.hubspotCompanyId}).</div>}
      {(d.hubspotCompanyId || d.hubspotContactIds.length > 0 || d.legacyHubspotTag) && (
        <div className="text-[12px] text-[#767C82]">
          Dane techniczne (HubSpot):{" "}
          {[d.hubspotCompanyId ? `firma ${d.hubspotCompanyId}` : null, d.hubspotContactIds.length ? `kontakty ${d.hubspotContactIds.join(", ")}` : null, d.legacyHubspotTag ? `tagi: ${d.legacyHubspotTag}` : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
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
            <button type="button" onClick={() => onDialog("archive")} className="text-[13px] text-[#767C82] hover:text-[#B8612F]">
              Archiwizuj
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

export function Tile({ children }: { children: ReactNode }) {
  return <div className="border border-[#CFE3DA] bg-white px-4 py-3.5 empty:hidden">{children}</div>;
}

// Kafel zwinięty domyślnie: tytuł + jedna linia podsumowania, klik rozwija.
function FoldTile({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[#CFE3DA] bg-white px-4 py-2.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="text-[14px] font-semibold text-[#0C3450]">{title}</span>
        <span className="bg-[#EEF0F2] px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.1em] text-[#5C6166]">{open ? "zwiń ▴" : "zwinięte ▾"}</span>
      </button>
      {open ? <div className="mt-1.5 pb-1">{children}</div> : <p className="mt-0.5 truncate text-[12px] text-[#8A939B]" title={summary}>{summary}</p>}
    </div>
  );
}

function profileSummary(d: ClientDetail): string {
  const p = d.profile;
  const links = p.links ? Object.entries(p.links).filter(([, v]) => v).map(([k]) => k) : [];
  const parts = [
    d.clinicType ? CLINIC_TYPE_LABEL[d.clinicType].toLowerCase() : null,
    p.services.length ? `${p.services.length} ${p.services.length === 1 ? "usługa" : "usług"}` : null,
    p.ownDevices ? "własne urządzenia" : null,
    d.deviceInterests.length ? d.deviceInterests.map((k) => DEVICE_INTEREST_LABEL[k]).join(", ") : null,
    p.seasonality ?? (d.rhythm.seasonalBreak.length ? `przerwa ${monthsLabel(d.rhythm.seasonalBreak)}` : null),
    d.source ? SOURCE_LABEL[d.source].toLowerCase() : null,
    links.length ? links.join(", ") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "rodzaj · usługi · własne urządzenia · zainteresowania · sezonowość · źródło · linki — do uzupełnienia";
}

function consentsSummary(d: ClientDetail): string {
  const p = d.profile;
  const mc = p.marketingConsent;
  return [
    `przypomnienia SMS: ${p.smsReminders === true ? "tak" : p.smsReminders === false ? "nie" : "nie ustalono"}`,
    `zgoda marketingowa: ${mc && (mc.email || mc.sms) ? "tak" : "brak"}`,
    `opinia Google: ${p.googleReview?.given ? "wystawiona" : p.googleReview?.askedAt ? `prośba ${dm(p.googleReview.askedAt)}` : "—"}`,
    d.statusOverride === "NIE_KONTAKTOWAC" ? "NIE KONTAKTOWAĆ" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function linksSummary(d: ClientDetail): string {
  return [
    d.aliases.length ? `${d.aliases.length} ${d.aliases.length === 1 ? "alias" : "aliasów"} z kalendarzy` : "brak aliasów z kalendarzy",
    d.lineage.length ? `${d.lineage.length} ${d.lineage.length === 1 ? "powiązanie" : "powiązania"} (wydzielenie / scalenie)` : null,
    d.hubspotCompanyId || d.hubspotContactIds.length ? "dane techniczne HubSpot" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function CardLeft(props: Props & { isAdmin: boolean; isAgent: boolean; pendingProposals: number; onDialog: (k: "merge" | "split" | "archive") => void }) {
  return (
    // Lewa kolumna = dane o gabinecie: każda sekcja w białym kaflu z bladozieloną
    // ramką #CFE3DA (jaśniejszą od zieleni statusów #2F7A68). Prawa — bez ramek.
    <div className="flex w-full shrink-0 flex-col gap-3 xl:w-[470px]">
      <Tile>
        <CompanySection {...props} />
      </Tile>
      <Tile>
        <TermsBlock d={props.d} onChanged={props.onChanged} notify={props.notify} />
      </Tile>
      <Tile>
        <PeopleSection {...props} />
      </Tile>
      <Tile>
        <DeliverySection {...props} />
      </Tile>
      <FoldTile title="Profil gabinetu" summary={profileSummary(props.d)}>
        <ProfileSection {...props} headless />
      </FoldTile>
      <FoldTile title="Zgody i komunikacja" summary={consentsSummary(props.d)}>
        <ConsentsSection {...props} headless />
      </FoldTile>
      <FoldTile title="Powiązania i aliasy" summary={linksSummary(props.d)}>
        <LinksSection d={props.d} isAdmin={props.isAdmin} isAgent={props.isAgent} pendingProposals={props.pendingProposals} onDialog={props.onDialog} headless />
      </FoldTile>
    </div>
  );
}
