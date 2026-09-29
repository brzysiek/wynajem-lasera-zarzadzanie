// Kolejka propozycji zmian — czyste reguły (vitest, bez @/): rodzaje,
// dozwolone pola, walidacja zgłoszenia od agenta.
import { AGENT_PROPOSAL_CLIENT_FIELDS } from "../permissions";
import { parseProvenance, type Provenance } from "../changelog/provenance";
import { parseArchiveInput, type ArchiveInput } from "./archive-rules";
import { parseSplitInput } from "../clients/split-rules";
import { parseExclusionList } from "./exclusion-rules";
import { PRICE_SOURCES, isTermsDevice } from "../clients/terms-rules";
import { LOST_REASON_KEYS, LOST_REASON_LABEL, TYPE_KEYS, type LostReasonKey } from "../leads/labels";
import { DEVICE_INTEREST_KEYS, RESIGN_REASON_KEYS, type DeviceInterestKey, type ResignReasonKey } from "../clients/labels";
import { POSTPONE_REASON_KEYS, type PostponeReasonKey } from "../leads/labels";
import type { LeadTypeKey } from "../leads/parse-deal";

export const PROPOSAL_KIND_LABEL = {
  FIELD: "pole klienta",
  CONTACT_FIELD: "pole osoby",
  ARCHIVE: "archiwizacja",
  MERGE: "scalenie duplikatu",
  SPLIT: "wydzielenie do nowego klienta",
  PAYMENT_MATCH: "dopasowanie przelewu do faktury",
  EXCLUSION: "lista wykluczeń domen",
  CLIENT_PRICE: "cena klienta (warunki handlowe)",
  DELIVERY_ADDRESS: "adres dostawy (paszport)",
  SIGNAL_NEW: "nowy sygnał (lejek)",
  LOST_REASON: "powód przegranej",
  LEAD_STEP: "następny krok sygnału",
  RENTAL_LINK: "powiązanie sygnału z wynajmem",
  CLIENT_NEW: "nowy klient",
  RENTAL_CLIENT: "klient rezerwacji",
  CLIENT_ALIAS: "alias klienta (tytuł wydarzenia)",
  CONTACT_LOG: "kontakt z klientką",
  POSTPONE: "odłożenie sygnału",
  RESIGN: "rezygnacja klienta",
} as const;
export type ProposalKind = keyof typeof PROPOSAL_KIND_LABEL;

export const PROPOSAL_STATUS_LABEL = { PENDING: "oczekuje", ACCEPTED: "zaakceptowana", REJECTED: "odrzucona" } as const;
export type ChangeProposalStatus = keyof typeof PROPOSAL_STATUS_LABEL;

export const CONTACT_PROPOSAL_FIELDS = ["firstName", "lastName", "phone", "phone2", "phone2Label", "email", "role", "roles", "preferredChannel", "salutation", "trainedOn"] as const;

const KIND_ALIASES: Record<string, ProposalKind> = {
  pole: "FIELD",
  field: "FIELD",
  osoba: "CONTACT_FIELD",
  contact_field: "CONTACT_FIELD",
  archiwizacja: "ARCHIVE",
  archive: "ARCHIVE",
  scalenie: "MERGE",
  merge: "MERGE",
  wydzielenie: "SPLIT",
  split: "SPLIT",
  dopasowanie_platnosci: "PAYMENT_MATCH",
  payment_match: "PAYMENT_MATCH",
  wykluczenie: "EXCLUSION",
  exclusion: "EXCLUSION",
  cennik_klienta: "CLIENT_PRICE",
  client_price: "CLIENT_PRICE",
  adres_dostawy: "DELIVERY_ADDRESS",
  delivery_address: "DELIVERY_ADDRESS",
  sygnal_nowy: "SIGNAL_NEW",
  powod_przegranej: "LOST_REASON",
  krok_sygnalu: "LEAD_STEP",
  powiazanie_wynajmu: "RENTAL_LINK",
  klient_nowy: "CLIENT_NEW",
  przypisanie_klienta: "RENTAL_CLIENT",
  alias_klienta: "CLIENT_ALIAS",
  kontakt: "CONTACT_LOG",
  odlozenie: "POSTPONE",
  rezygnacja: "RESIGN",
};

export type SignalNewProposal = {
  type: LeadTypeKey;
  clientId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  deviceInterest: DeviceInterestKey[];
  requestedFrom: string | null; // RRRR-MM-DD
  requestedDays: number | null;
  message: string | null;
  sourceRef: string | null;
};
export type LostReasonProposal = { lostReason: LostReasonKey; lostNote: string | null };
export type LeadStepProposal = { at: string; stepType: string; note: string | null };
export type RentalLinkProposal = { rentalId: string };
// Wniosek 23: klient rezerwacji z panelu (agent przez propozycje).
export type ClientNewProposal = { name: string; phone: string | null; email: string | null; city: string | null; source: string | null };
export type RentalClientProposal = { rentalId: string; alias: boolean };
export type ClientAliasProposal = { title: string };
// Wniosek 24: kontakt odnotowany przez agenta (z notatek / maili), odłożenie
// sygnału i rezygnacja klienta.
export const CONTACT_CHANNELS = ["telefon", "sms", "mail"] as const;
export const CONTACT_RESULTS = ["rozmowa", "nie_odebrala"] as const;
export type ContactLogProposal = { at: string; channel: (typeof CONTACT_CHANNELS)[number]; result: (typeof CONTACT_RESULTS)[number]; note: string | null };
export type PostponeProposal = { returnAt: string; reason: PostponeReasonKey; note: string | null };
export type ResignProposal = { reason: ResignReasonKey; note: string | null; recontactAt: string | null };

const LEAD_STEP_TYPES = ["PIERWSZY_KONTAKT", "PONOWNA_PROBA", "FOLLOW_UP_OFERTY", "ODDZWONI", "DOPYTAC", "UMOW_TERMIN", "INNE"];
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/[^a-z]+/g, " ").trim();
function lostReasonOf(v: unknown): LostReasonKey | null {
  if (typeof v !== "string") return null;
  if ((LOST_REASON_KEYS as string[]).includes(v)) return v as LostReasonKey;
  const f = fold(v);
  const hit = LOST_REASON_KEYS.find((k) => fold(LOST_REASON_LABEL[k]) === f || fold(LOST_REASON_LABEL[k]).startsWith(f));
  return hit ?? null;
}

// Adres dostawy od agenta: polskie klucze → pola ClientDeliveryAddress.
const ADDRESS_KEYS: Record<string, string> = {
  nazwa: "label",
  ulica: "street",
  kod: "zip",
  miejscowosc: "city",
  miasto: "city",
  wejscie: "entrance",
  pietro: "floor",
  parking: "parking",
  prad: "power",
  odbiera: "receiver",
  godziny: "openingHours",
  typowa_godzina: "usualStartTime",
  uwagi_biura: "officeNotes",
};
const ADDRESS_FIELDS = new Set(Object.values(ADDRESS_KEYS));

export type ClientPriceProposal = { device: string; days: number; priceNet: number | null; source: string; sourceRef: string | null; since?: string | null };
export type DeliveryAddressProposal = { addressId: string | null; isDefault?: boolean } & Record<string, string | null | boolean | undefined>;

export type ParsedProposal = {
  kind: ProposalKind;
  clientId: string | null;
  contactId: string | null;
  leadId: string | null;
  field: string | null;
  proposed: unknown; // FIELD/CONTACT_FIELD: wartość; ARCHIVE: ArchiveInput; MERGE: { duplicateId }; PAYMENT_MATCH: { transferId, fakturowniaInvoiceId }
  provenance: Provenance;
  changeClass: string | null;
};

const str = (v: unknown, max = 191) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// Klasa zmiany: krótki klucz, np. „miasto_slownik” (małe litery, cyfry, _).
export function normalizeClass(v: unknown): string | null {
  const s = str(v, 64);
  if (!s) return null;
  const k = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return k || null;
}

export function parseProposalItem(item: Record<string, unknown>): { ok: true; value: ParsedProposal } | { ok: false; message: string } {
  const rawKind = str(item.rodzaj ?? item.kind, 32)?.toLowerCase();
  const kind = rawKind ? KIND_ALIASES[rawKind] : undefined;
  if (!kind)
    return {
      ok: false,
      message: "rodzaj: pole, osoba, archiwizacja, scalenie, wydzielenie, dopasowanie_platnosci, wykluczenie, cennik_klienta, adres_dostawy, sygnal_nowy, powod_przegranej, krok_sygnalu, powiazanie_wynajmu, klient_nowy, przypisanie_klienta, alias_klienta, kontakt, odlozenie albo rezygnacja.",
    };
  const provenance = parseProvenance(item, { required: true });
  if (!provenance.ok) return provenance;
  if (!provenance.value.batch) return { ok: false, message: "Podaj paczkę (paczka)." };
  const clientId = str(item.klient_id ?? item.clientId, 64);
  const changeClass = normalizeClass(item.klasa ?? item.changeClass);
  const base = { clientId, contactId: null, leadId: null, field: null, provenance: provenance.value, changeClass };

  if (kind === "FIELD" || kind === "CONTACT_FIELD") {
    if (!clientId) return { ok: false, message: "Podaj klient_id." };
    const field = str(item.pole ?? item.field, 64);
    const allowed: readonly string[] = kind === "FIELD" ? AGENT_PROPOSAL_CLIENT_FIELDS : CONTACT_PROPOSAL_FIELDS;
    if (!field || !allowed.includes(field)) return { ok: false, message: `pole: ${allowed.join(", ")}.` };
    if (!("proponowane" in item) && !("proposed" in item)) return { ok: false, message: "Podaj proponowane (może być null)." };
    const contactId = kind === "CONTACT_FIELD" ? str(item.osoba_id ?? item.contactId, 64) : null;
    if (kind === "CONTACT_FIELD" && !contactId) return { ok: false, message: "Podaj osoba_id." };
    return { ok: true, value: { ...base, kind, contactId, field, proposed: item.proponowane ?? item.proposed ?? null } };
  }
  if (kind === "SIGNAL_NEW") {
    const typeRaw = str(item.zrodlo_sygnalu ?? item.typ ?? item.type, 32)?.toUpperCase() ?? "EMAIL";
    const type = (TYPE_KEYS as string[]).includes(typeRaw) ? (typeRaw as LeadTypeKey) : null;
    if (!type) return { ok: false, message: "zrodlo_sygnalu: EMAIL, TELEFON, OLX, POLECENIE albo INNE." };
    const devRaw = item.urzadzenia ?? item.urzadzenie ?? [];
    const devices = (Array.isArray(devRaw) ? devRaw : [devRaw]).filter((x): x is string => typeof x === "string").map((x) => x.toUpperCase());
    if (devices.some((d) => !(DEVICE_INTEREST_KEYS as string[]).includes(d))) return { ok: false, message: `urzadzenie: ${DEVICE_INTEREST_KEYS.join(", ")}.` };
    const proposed: SignalNewProposal = {
      type,
      clientId,
      contactName: str(item.imie ?? item.osoba ?? item.contactName, 191),
      contactPhone: str(item.telefon ?? item.contactPhone, 32),
      contactEmail: str(item.email ?? item.contactEmail, 191)?.toLowerCase() ?? null,
      deviceInterest: devices as DeviceInterestKey[],
      requestedFrom: str(item.termin ?? item.requestedFrom, 10),
      requestedDays: Number.isInteger(Number(item.dni)) && Number(item.dni) > 0 ? Number(item.dni) : null,
      message: str(item.notatka ?? item.message, 2000),
      sourceRef: str(item.odnosnik ?? item.sourceRef, 191),
    };
    if (!clientId && !proposed.contactName && !proposed.contactPhone && !proposed.contactEmail) return { ok: false, message: "Podaj klient_id albo imie / telefon / email." };
    if (proposed.requestedFrom && !/^\d{4}-\d{2}-\d{2}$/.test(proposed.requestedFrom)) return { ok: false, message: "termin: RRRR-MM-DD." };
    return { ok: true, value: { ...base, kind, field: proposed.sourceRef, proposed } };
  }
  if (kind === "CONTACT_LOG" || kind === "POSTPONE") {
    const leadId = str(item.sygnal_id ?? item.leadId, 64);
    if (!leadId) return { ok: false, message: "Podaj sygnal_id." };
    if (kind === "CONTACT_LOG") {
      const at = str(item.data ?? item.at, 16);
      if (!at || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(at)) return { ok: false, message: "data: RRRR-MM-DD albo RRRR-MM-DDTHH:MM." };
      const channel = (str(item.kanal ?? item.channel, 16)?.toLowerCase() ?? "telefon") as ContactLogProposal["channel"];
      if (!CONTACT_CHANNELS.includes(channel)) return { ok: false, message: "kanal: telefon, sms albo mail." };
      const result = (str(item.wynik ?? item.result, 16)?.toLowerCase() ?? "rozmowa") as ContactLogProposal["result"];
      if (!CONTACT_RESULTS.includes(result)) return { ok: false, message: "wynik: rozmowa albo nie_odebrala." };
      return { ok: true, value: { ...base, kind, leadId, field: `${at}|${channel}`, proposed: { at, channel, result, note: str(item.notatka ?? item.note, 2000) } satisfies ContactLogProposal } };
    }
    const returnAt = str(item.data_powrotu ?? item.returnAt, 10);
    if (!returnAt || !/^\d{4}-\d{2}-\d{2}$/.test(returnAt)) return { ok: false, message: "data_powrotu: RRRR-MM-DD." };
    const reasonRaw = str(item.powod ?? item.reason, 32)?.toUpperCase() ?? "";
    if (!(POSTPONE_REASON_KEYS as readonly string[]).includes(reasonRaw)) return { ok: false, message: `powod: ${POSTPONE_REASON_KEYS.join(", ")}.` };
    return { ok: true, value: { ...base, kind, leadId, field: "returnAt", proposed: { returnAt, reason: reasonRaw as PostponeReasonKey, note: str(item.notatka ?? item.note, 1000) } satisfies PostponeProposal } };
  }
  if (kind === "RESIGN") {
    if (!clientId) return { ok: false, message: "Podaj klient_id." };
    const reasonRaw = str(item.powod ?? item.reason, 32)?.toUpperCase() ?? "";
    if (!(RESIGN_REASON_KEYS as readonly string[]).includes(reasonRaw)) return { ok: false, message: `powod: ${RESIGN_REASON_KEYS.join(", ")}.` };
    const recontactAt = str(item.data_ponownego_kontaktu ?? item.recontactAt, 10);
    if (recontactAt && !/^\d{4}-\d{2}-\d{2}$/.test(recontactAt)) return { ok: false, message: "data_ponownego_kontaktu: RRRR-MM-DD." };
    return { ok: true, value: { ...base, kind, field: "resigned", proposed: { reason: reasonRaw as ResignReasonKey, note: str(item.notatka ?? item.note, 1000), recontactAt } satisfies ResignProposal } };
  }
  if (kind === "CLIENT_NEW") {
    const proposed: ClientNewProposal = {
      name: str(item.nazwa ?? item.imie ?? item.name, 191) ?? "",
      phone: str(item.telefon ?? item.phone, 32),
      email: str(item.email, 191)?.toLowerCase() ?? null,
      city: str(item.miasto ?? item.miejscowosc ?? item.city, 191),
      source: str(item.zrodlo_klienta ?? item.clientSource, 32),
    };
    if (!proposed.name) return { ok: false, message: "Podaj nazwa (imię i nazwisko albo nazwa gabinetu)." };
    if (!proposed.phone && !proposed.email) return { ok: false, message: "Podaj telefon albo email (jedno z dwóch)." };
    return { ok: true, value: { ...base, clientId: null, kind, field: proposed.phone ?? proposed.email, proposed } };
  }
  if (kind === "RENTAL_CLIENT") {
    if (!clientId) return { ok: false, message: "Podaj klient_id." };
    const rentalId = str(item.wynajem_id ?? item.rentalId, 64);
    if (!rentalId) return { ok: false, message: "Podaj wynajem_id (z rezerwacje_bez_klienta albo kalendarz_wynajmy)." };
    return { ok: true, value: { ...base, kind, field: rentalId, proposed: { rentalId, alias: item.alias === true } satisfies RentalClientProposal } };
  }
  if (kind === "CLIENT_ALIAS") {
    if (!clientId) return { ok: false, message: "Podaj klient_id." };
    const title = str(item.tytul ?? item.title, 191);
    if (!title) return { ok: false, message: "Podaj tytul (tytuł wydarzenia albo jego rdzeń)." };
    return { ok: true, value: { ...base, kind, field: title, proposed: { title } satisfies ClientAliasProposal } };
  }
  if (kind === "LOST_REASON" || kind === "LEAD_STEP" || kind === "RENTAL_LINK") {
    const leadId = str(item.sygnal_id ?? item.leadId, 64);
    if (!leadId) return { ok: false, message: "Podaj sygnal_id." };
    if (kind === "LOST_REASON") {
      const reason = lostReasonOf(item.powod ?? item.lostReason);
      if (!reason || reason === "ARCHIWUM_IMPORTU") return { ok: false, message: "powod: ODLEGLOSC (za daleko), CENA, KUPILA_URZADZENIE, TERMIN_ZAJETY, BRAK_KONTAKTU, TYLKO_CENNIK, POZA_BRANZA, INNE_URZADZENIE albo INNE (z notatką)." };
      const note = str(item.notatka ?? item.lostNote, 2000);
      if (reason === "INNE" && !note) return { ok: false, message: "Przy powodzie INNE dodaj notatkę." };
      return { ok: true, value: { ...base, kind, leadId, field: "lostReason", proposed: { lostReason: reason, lostNote: note } satisfies LostReasonProposal } };
    }
    if (kind === "LEAD_STEP") {
      const at = str(item.termin ?? item.at, 16);
      if (!at || !/^\d{4}-\d{2}-\d{2}/.test(at)) return { ok: false, message: "termin: RRRR-MM-DD (opcjonalnie z godziną RRRR-MM-DDTHH:MM)." };
      const stepType = str(item.rodzaj_kroku ?? item.stepType, 20)?.toUpperCase() ?? "INNE";
      if (!LEAD_STEP_TYPES.includes(stepType)) return { ok: false, message: `rodzaj_kroku: ${LEAD_STEP_TYPES.join(", ")}.` };
      return { ok: true, value: { ...base, kind, leadId, field: "nextStep", proposed: { at, stepType, note: str(item.notatka ?? item.note, 500) } satisfies LeadStepProposal } };
    }
    const rentalId = str(item.wynajem_id ?? item.rentalId, 64);
    if (!rentalId) return { ok: false, message: "Podaj wynajem_id (z kalendarz_wynajmy)." };
    return { ok: true, value: { ...base, kind, leadId, field: "rentalId", proposed: { rentalId } satisfies RentalLinkProposal } };
  }
  if (kind === "CLIENT_PRICE") {
    if (!clientId) return { ok: false, message: "Podaj klient_id." };
    const device = item.urzadzenie ?? item.device;
    if (!isTermsDevice(device)) return { ok: false, message: "urzadzenie: LS_1G, LS_2G, ET400, ALMA_DYEVL, ALMA_DYEVL_IPIXEL, ALMA_IPIXEL, COOLTECH, RESURFX, OBSERV albo SZKOLENIE." };
    const days = Number(item.dni ?? item.days);
    if (!Number.isInteger(days) || days < 1 || days > 31) return { ok: false, message: "dni: liczba dni wynajmu 1–31." };
    const remove = item.usun === true || item.remove === true;
    const rawPrice = item.cena ?? item.priceNet;
    const price = remove ? null : Number(typeof rawPrice === "string" ? rawPrice.replace(/\s/g, "").replace(",", ".") : rawPrice);
    if (!remove && (price == null || !Number.isFinite(price) || price <= 0 || price > 100000)) return { ok: false, message: "cena: kwota netto wynajmu (albo usun: true)." };
    const src = str(item.zrodlo_ceny ?? item.priceSource, 32)?.toUpperCase() ?? "AGENT";
    const proposed: ClientPriceProposal = {
      device,
      days,
      priceNet: price == null ? null : Math.round(price * 100) / 100,
      source: (PRICE_SOURCES as readonly string[]).includes(src) ? src : "AGENT",
      sourceRef: str(item.odnosnik ?? item.sourceRef, 191),
    };
    // Wniosek 28: wersja obowiązuje od (RRRR-MM-DD); brak = od akceptacji.
    const od = str(item.od ?? item.since, 10);
    if (od) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(od)) return { ok: false, message: "od: data RRRR-MM-DD (od kiedy obowiązuje cena)." };
      proposed.since = od;
    }
    return { ok: true, value: { ...base, kind, field: `${device}|${days}`, proposed } };
  }
  if (kind === "DELIVERY_ADDRESS") {
    if (!clientId) return { ok: false, message: "Podaj klient_id." };
    const addressId = str(item.adres_id ?? item.addressId, 64);
    const proposed: DeliveryAddressProposal = { addressId };
    for (const [k, v] of Object.entries(item)) {
      const field = ADDRESS_KEYS[k] ?? (ADDRESS_FIELDS.has(k) ? k : null);
      if (!field) continue;
      if (v !== null && typeof v !== "string") return { ok: false, message: `${k}: tekst albo null.` };
      proposed[field] = v === null ? null : v.trim().slice(0, 2000) || null;
    }
    const def = item.domyslny ?? item.isDefault;
    if (def === true) proposed.isDefault = true;
    if (Object.keys(proposed).length <= 1) return { ok: false, message: "Podaj pola adresu (nazwa, ulica, kod, miejscowosc, wejscie, pietro, parking, prad, odbiera, godziny, typowa_godzina, uwagi_biura, domyslny)." };
    if (!addressId && !proposed.city && !proposed.zip) return { ok: false, message: "Nowy adres: podaj miejscowosc albo kod." };
    return { ok: true, value: { ...base, kind, field: addressId ?? "nowy", proposed } };
  }
  if (kind === "ARCHIVE") {
    const leadId = str(item.sygnal_id ?? item.leadId, 64);
    if (!clientId && !leadId) return { ok: false, message: "Podaj klient_id albo sygnal_id." };
    if (clientId && leadId) return { ok: false, message: "Archiwizacja dotyczy klienta albo sygnału — nie obu naraz." };
    const archive = parseArchiveInput(item);
    if (!archive.ok) return archive;
    return { ok: true, value: { ...base, kind, leadId, proposed: archive.value satisfies ArchiveInput } };
  }
  if (kind === "SPLIT") {
    if (!clientId) return { ok: false, message: "Podaj klient_id (klient-zlepek)." };
    const split = parseSplitInput(item);
    if (!split.ok) return split;
    return { ok: true, value: { ...base, kind, proposed: split.value } };
  }
  if (kind === "EXCLUSION") {
    const raw = item.wartosci ?? item.values;
    const text = Array.isArray(raw) ? raw.filter((x) => typeof x === "string").join("\n") : typeof raw === "string" ? raw : "";
    const { values, errors } = parseExclusionList(text);
    if (!values.length) return { ok: false, message: errors[0] ?? "Podaj wartosci — domeny albo adresy e-mail." };
    if (values.length > 500) return { ok: false, message: "Maks. 500 domen w jednej propozycji." };
    const t = str(item.typ ?? item.kind_list, 16)?.toLowerCase();
    const listKind = t === "ukrywaj" || t === "hide" ? "HIDE" : "EXCLUDE";
    return { ok: true, value: { ...base, kind, proposed: { values, kind: listKind, note: str(item.dopisek ?? item.note, 500) } } };
  }
  if (kind === "PAYMENT_MATCH") {
    const transferId = str(item.przelew_id ?? item.transferId, 64);
    const invoiceRaw = item.faktura_id ?? item.fakturowniaInvoiceId;
    const fakturowniaInvoiceId = typeof invoiceRaw === "number" ? invoiceRaw : typeof invoiceRaw === "string" && /^\d+$/.test(invoiceRaw.trim()) ? Number(invoiceRaw) : NaN;
    if (!transferId) return { ok: false, message: "Podaj przelew_id (z narzędzia platnosci)." };
    if (!Number.isInteger(fakturowniaInvoiceId) || fakturowniaInvoiceId <= 0) return { ok: false, message: "Podaj faktura_id (liczbowe ID faktury z narzędzia platnosci)." };
    return { ok: true, value: { ...base, kind, proposed: { transferId, fakturowniaInvoiceId } } };
  }
  // MERGE
  const duplicateId = str(item.duplikat_id ?? item.duplicateId, 64);
  if (!clientId || !duplicateId) return { ok: false, message: "Podaj klient_id (zostaje) i duplikat_id." };
  if (clientId === duplicateId) return { ok: false, message: "Duplikat musi być innym klientem." };
  return { ok: true, value: { ...base, kind, proposed: { duplicateId } } };
}

// Wartość podana, a po walidacji pusta = nierozpoznana (np. liczba w polu
// kwotowym przed poprawką z wniosku 17) — propozycję odrzucamy, zamiast po
// akceptacji wyczyścić pole. Czyszczenie tylko jawne: proponowane null albo "".
export function silentClearMessage(field: string, proposed: unknown, normalized: unknown): string | null {
  const given = proposed !== null && proposed !== undefined && !(typeof proposed === "string" && proposed.trim() === "");
  return given && normalized === null ? `${field}: nie rozpoznano wartości ${JSON.stringify(proposed)} — pole wyczyścisz tylko przez proponowane: null.` : null;
}
