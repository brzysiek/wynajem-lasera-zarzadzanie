// „Jakość danych” na karcie klienta (sekcja 2 i 4): kompletność % = pola
// wypełnione / pola oczekiwane dla statusu, lista braków i źródeł. Czysty
// moduł (vitest bez "@/"); wejście to fragment ClientDetail.
import { completeness } from "./rhythm";

export type QualityInput = {
  status: string; // ClientStatus
  name: string;
  nip: string | null;
  street: string | null;
  city: string | null;
  clinicType: string | null;
  hubspotCompanyId: string | null;
  aliasesCount: number;
  invoicesCount: number;
  rentalsTotal: number;
  paymentsAsOf: string | null;
  contacts: { phone: string | null; email: string | null; roles: string[]; trainedOn: unknown[]; isPrimary: boolean }[];
  profile: {
    regon: string | null;
    legalForm: string | null;
    businessStartDate: string | null;
    pkd: unknown[];
    vatStatus: string | null;
    deliveryAddress: string | null;
    deliveryNotes: { entrance: string | null; floor: string | null; parking: string | null; power: string | null } | null;
    services: string[];
    openingHours: string | null;
    ownDevices: string | null;
    invoiceEmail: string | null;
    paymentTerms: string | null;
    paymentForm?: string | null;
    marketingConsent: unknown | null;
    smsReminders: boolean | null;
  };
  fieldSources: string[]; // źródła z pochodzenia pól (bialalista, ceidg, panel, agent…)
};

type Check = { key: string; label: string; ok: boolean };

const SOURCE_LABEL: Record<string, string> = {
  bialalista: "Biała lista",
  ceidg: "CEIDG",
  panel: "panel",
  agent: "agent",
  hubspot: "HubSpot",
  fakturownia: "Fakturownia",
  kalendarze: "kalendarze",
  bank: "wyciągi bankowe",
};
export const sourceLabel = (s: string) => SOURCE_LABEL[s.toLowerCase()] ?? s;

export function cardQuality(q: QualityInput) {
  const primary = q.contacts.find((c) => c.isPrimary) ?? q.contacts[0] ?? null;
  const p = q.profile;
  const base: Check[] = [
    { key: "name", label: "nazwa", ok: !!q.name.trim() },
    { key: "phone", label: "telefon osoby głównej", ok: !!primary?.phone },
    { key: "email", label: "e-mail osoby głównej", ok: !!primary?.email },
    { key: "city", label: "miasto", ok: !!q.city },
    { key: "clinicType", label: "typ gabinetu", ok: !!q.clinicType },
  ];
  const client: Check[] = [
    { key: "nip", label: "NIP", ok: !!q.nip },
    { key: "regon", label: "REGON", ok: !!p.regon },
    { key: "street", label: "adres", ok: !!q.street },
    { key: "legalForm", label: "forma i data rozpoczęcia", ok: !!p.legalForm && !!p.businessStartDate },
    { key: "pkd", label: "PKD", ok: p.pkd.length > 0 },
    { key: "vatStatus", label: "status VAT", ok: !!p.vatStatus },
    { key: "roles", label: "role osób", ok: q.contacts.some((c) => c.roles.length > 0) },
    { key: "delivery", label: "dojazd i zasilanie", ok: !!p.deliveryNotes && !!(p.deliveryNotes.entrance || p.deliveryNotes.floor) && !!p.deliveryNotes.power },
    { key: "services", label: "usługi", ok: p.services.length > 0 },
    { key: "openingHours", label: "godziny otwarcia", ok: !!p.openingHours },
    { key: "ownDevices", label: "własne urządzenia gabinetu", ok: !!p.ownDevices },
    { key: "trainedOn", label: "data szkolenia", ok: q.contacts.some((c) => c.trainedOn.length > 0) },
    { key: "invoiceEmail", label: "e-mail do faktur", ok: !!p.invoiceEmail },
    { key: "paymentForm", label: "forma płatności", ok: !!p.paymentForm },
    { key: "marketingConsent", label: "zgoda marketingowa", ok: !!p.marketingConsent },
    { key: "smsReminders", label: "SMS-przypomnienia", ok: p.smsReminders !== null },
    { key: "payments", label: "wpłaty (wyciąg z banku)", ok: !!q.paymentsAsOf },
  ];
  const expected = q.status === "POTENCJALNY" || q.status === "NIE_KONTAKTOWAC" ? base : [...base, ...client];
  const filled = Object.fromEntries(expected.map((c) => [c.key, c.ok]));
  const { percent } = completeness(filled, expected.map((c) => c.key));

  const sources = new Set<string>();
  for (const s of q.fieldSources) for (const part of s.split(/\s*[·,+;]\s*/)) if (part.trim()) sources.add(sourceLabel(part.trim()));
  if (q.invoicesCount) sources.add("Fakturownia");
  if (q.aliasesCount || q.rentalsTotal) sources.add("kalendarze urządzeń");
  if (q.paymentsAsOf) sources.add("wyciągi bankowe");
  if (q.hubspotCompanyId) sources.add("HubSpot");

  return {
    percent,
    confirmed: expected.filter((c) => c.ok).map((c) => c.label),
    missing: expected.filter((c) => !c.ok).map((c) => c.label),
    sources: [...sources],
  };
}
