// Planowanie importu klientów z HubSpota — CZYSTA funkcja: z surowych
// kontaktów i firm HubSpota wylicza, jacy klienci (gabinety) i osoby
// powstaną, plus raport problemów do pokazania ADMINOWI przed zapisem
// (podgląd / dry run). Nic nie zapisuje; zapis robi
// src/lib/clients/hubspot-import-run.ts. Bez zależności ("@/" nie działa w
// vitest) — normalizacja telefonu wstrzykiwana (normalizePolishPhone z
// src/lib/reminders.ts, ta sama co wysyłka SMS).
//
// Stan danych HubSpota (sprawdzony 25.09.2026, nie zakładany): NIP istnieje
// TYLKO na kontaktach (firmy nie mają takiej właściwości), tylko ~73 z 456
// kontaktów jest powiązanych z firmą — większość gabinetów ma nazwę wpisaną
// ręcznie w polu `company` kontaktu. Łączenie po samej nazwie świadomie NIE
// jest automatyczne (zbyt ogólne nazwy typu „Gabinet Kosmetyczny”) —
// podejrzane zbieżności nazw trafiają do raportu jako możliwe duplikaty.

export type HsContact = {
  id: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  phone: string | null;
  mobilephone: string | null;
  company: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  country: string | null;
  nip: string | null;
  ustalona_cena_transportu: string | null;
  odlegosc_od_bazy: string | null;
  tagi: string | null; // wielokrotny wybór, wartości rozdzielone ";"
  urzadzenie: string | null; // wielokrotny wybór, wartości rozdzielone ";"
  createdate: string | null;
  companyIds: string[];
};

export type HsCompany = {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  country: string | null;
};

export type DeviceInterestValue =
  | "LIGHTSHEER"
  | "LIGHTSHEER_ET400"
  | "ALMA_HARMONY"
  | "COOLTECH"
  | "RESURFX"
  | "OBSERV"
  | "SZKOLENIE";

export type PlannedContact = {
  hubspotContactId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null; // E.164, albo surowy tekst gdy nie dało się sparsować
  email: string | null;
  isPrimary: boolean;
  // Surowe wartości HubSpota w chwili importu — podstawa scalania zmian w
  // synchronizacji (spec 5.5): pozwala odróżnić zmianę w HubSpocie od
  // zmiany w panelu. Celowo SUROWE (np. telefon „501 234 567”, nie E.164).
  snapshot: Record<string, string | null>;
};

export type PlannedClient = {
  // Klucz grupowania — stabilny między przebiegami (idempotencja importu).
  key: string; // "company:<id>" | "nip:<nip>" | "contact:<id>"
  hubspotCompanyId: string | null;
  name: string;
  nip: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string;
  transportPriceNet: string | null; // liczba jako tekst, pod Prisma.Decimal
  distanceKm: string | null;
  deviceInterests: DeviceInterestValue[];
  statusOverride: "NIE_KONTAKTOWAC" | null;
  source: "FORMULARZ_WWW" | null;
  legacyHubspotTag: string | null;
  contacts: PlannedContact[];
  // Surowe wartości pól klienta, które panel będzie odsyłał do kontaktów
  // HubSpota (spec 5.4) — z osoby głównej.
  snapshot: Record<string, string | null>;
};

export type ImportReport = {
  contactsFetched: number;
  companiesFetched: number;
  clientsPlanned: number;
  multiPersonClients: { key: string; name: string; people: string[] }[];
  possibleDuplicateNames: { name: string; count: number }[];
  nipAcrossCompanies: { nip: string; companies: string[] }[];
  duplicateEmails: { email: string; contacts: string[] }[];
  noEmailNoPhone: string[];
  unparsedPhones: { contact: string; value: string }[];
  unparsedNips: { contact: string; value: string }[];
  unparsedTransportPrices: { contact: string; value: string }[];
};

const DEVICE_MAP: Record<string, DeviceInterestValue> = {
  lightsheer: "LIGHTSHEER",
  cooltech: "COOLTECH",
  observ: "OBSERV",
  rersurfx: "RESURFX", // literówka w samej opcji HubSpota
  resurfx: "RESURFX",
  almaharmonyxl: "ALMA_HARMONY",
};

const TAG_DO_NOT_CONTACT = "nie planujemy współpracy";
const TAG_WEB_FORM = "pobranie oferty ze strony";

function clean(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function splitMulti(v: string | null): string[] {
  return (v ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeNip(raw: string | null): { nip: string | null; invalid: boolean } {
  const v = clean(raw);
  if (!v) return { nip: null, invalid: false };
  const digits = v.replace(/\D/g, "");
  return digits.length === 10 ? { nip: digits, invalid: false } : { nip: null, invalid: true };
}

// „150”, „150,00”, „150 zł”, „150.5” → "150.00"; śmieci → null.
export function parseMoney(raw: string | null): { value: string | null; invalid: boolean } {
  const v = clean(raw);
  if (!v) return { value: null, invalid: false };
  const n = Number(v.replace(/zł|pln/gi, "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? { value: n.toFixed(2), invalid: false } : { value: null, invalid: true };
}

// „35”, „35 km”, „35,5km” → "35.5"; śmieci → null.
export function parseDistanceKm(raw: string | null): string | null {
  const v = clean(raw);
  if (!v) return null;
  const m = v.replace(",", ".").match(/\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(1) : null;
}

export function mapDevices(raw: string | null): DeviceInterestValue[] {
  const out = new Set<DeviceInterestValue>();
  for (const v of splitMulti(raw)) {
    const mapped = DEVICE_MAP[v.toLowerCase().replace(/\s/g, "")];
    if (mapped) out.add(mapped);
  }
  return [...out];
}

function personName(c: HsContact): string | null {
  return clean([clean(c.firstname), clean(c.lastname)].filter(Boolean).join(" "));
}

function contactLabel(c: HsContact): string {
  return personName(c) ?? clean(c.email) ?? clean(c.company) ?? `kontakt ${c.id}`;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

export function planHubspotImport(
  input: { contacts: HsContact[]; companies: HsCompany[] },
  deps: { normalizePhone: (raw: string) => string | null },
): { clients: PlannedClient[]; report: ImportReport } {
  const companiesById = new Map(input.companies.map((c) => [c.id, c]));
  const report: ImportReport = {
    contactsFetched: input.contacts.length,
    companiesFetched: input.companies.length,
    clientsPlanned: 0,
    multiPersonClients: [],
    possibleDuplicateNames: [],
    nipAcrossCompanies: [],
    duplicateEmails: [],
    noEmailNoPhone: [],
    unparsedPhones: [],
    unparsedNips: [],
    unparsedTransportPrices: [],
  };

  const nipOf = new Map<string, string | null>();
  for (const c of input.contacts) {
    const { nip, invalid } = normalizeNip(c.nip);
    nipOf.set(c.id, nip);
    if (invalid) report.unparsedNips.push({ contact: contactLabel(c), value: c.nip ?? "" });
  }

  // 1) kontakty powiązane z firmą HubSpot → klient tej firmy.
  const groups = new Map<string, HsContact[]>();
  const keyByNip = new Map<string, string>();
  const nipCompanies = new Map<string, Set<string>>();
  const loose: HsContact[] = [];
  for (const c of input.contacts) {
    const companyId = c.companyIds.find((id) => companiesById.has(id));
    if (!companyId) {
      loose.push(c);
      continue;
    }
    const key = `company:${companyId}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
    const nip = nipOf.get(c.id);
    if (nip) {
      if (!keyByNip.has(nip)) keyByNip.set(nip, key);
      nipCompanies.set(nip, (nipCompanies.get(nip) ?? new Set()).add(companyId));
    }
  }
  for (const [nip, ids] of nipCompanies) {
    if (ids.size > 1) {
      report.nipAcrossCompanies.push({ nip, companies: [...ids].map((id) => companiesById.get(id)?.name ?? id) });
    }
  }

  // 2) bez firmy, z NIP → do klienta o tym samym NIP (także firmowego);
  // 3) reszta → osobny klient.
  for (const c of loose) {
    const nip = nipOf.get(c.id);
    let key: string;
    if (nip) {
      key = keyByNip.get(nip) ?? `nip:${nip}`;
      if (!keyByNip.has(nip)) keyByNip.set(nip, key);
    } else {
      key = `contact:${c.id}`;
    }
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const emails = new Map<string, string[]>();
  const clients: PlannedClient[] = [];
  for (const [key, members] of groups) {
    // Najstarszy kontakt = osoba główna (spec, reguła 4).
    const sorted = [...members].sort((a, b) => (a.createdate ?? "").localeCompare(b.createdate ?? ""));
    const primary = sorted[0];
    const company = key.startsWith("company:") ? companiesById.get(key.slice(8)) : undefined;

    const contacts: PlannedContact[] = sorted.map((c, i) => {
      const rawPhone = clean(c.phone) ?? clean(c.mobilephone);
      let phone: string | null = null;
      if (rawPhone) {
        const normalized = deps.normalizePhone(rawPhone);
        // Nieparsowalny zostaje jako surowy tekst (spec 5.2, reguła 5) —
        // lepiej mieć cokolwiek do zadzwonienia niż nic.
        if (!normalized) report.unparsedPhones.push({ contact: contactLabel(c), value: rawPhone });
        phone = normalized ?? rawPhone;
      }
      const email = clean(c.email)?.toLowerCase() ?? null;
      if (email) emails.set(email, [...(emails.get(email) ?? []), contactLabel(c)]);
      if (!email && !rawPhone) report.noEmailNoPhone.push(contactLabel(c));
      return {
        hubspotContactId: c.id,
        firstName: clean(c.firstname),
        lastName: clean(c.lastname),
        phone,
        email,
        isPrimary: i === 0,
        snapshot: { firstname: c.firstname, lastname: c.lastname, phone: c.phone, mobilephone: c.mobilephone, email: c.email },
      };
    });

    let transportPriceNet: string | null = null;
    let distanceKm: string | null = null;
    const devices = new Set<DeviceInterestValue>();
    const tags = new Set<string>();
    for (const c of sorted) {
      const price = parseMoney(c.ustalona_cena_transportu);
      if (price.invalid) report.unparsedTransportPrices.push({ contact: contactLabel(c), value: c.ustalona_cena_transportu ?? "" });
      transportPriceNet ??= price.value;
      distanceKm ??= parseDistanceKm(c.odlegosc_od_bazy);
      mapDevices(c.urzadzenie).forEach((d) => devices.add(d));
      splitMulti(c.tagi).forEach((t) => tags.add(t));
    }
    const lowerTags = new Set([...tags].map((t) => t.toLowerCase()));

    const name =
      clean(company?.name) ??
      clean(primary.company) ??
      personName(primary) ??
      clean(primary.email)?.toLowerCase() ??
      `Klient ${primary.id}`;

    clients.push({
      key,
      hubspotCompanyId: company?.id ?? null,
      name,
      nip: sorted.map((c) => nipOf.get(c.id)).find(Boolean) ?? null,
      street: clean(company?.address) ?? clean(primary.address),
      zip: clean(company?.zip) ?? clean(primary.zip),
      city: clean(company?.city) ?? clean(primary.city),
      country: clean(company?.country) ?? clean(primary.country) ?? "Polska",
      transportPriceNet,
      distanceKm,
      deviceInterests: [...devices],
      statusOverride: lowerTags.has(TAG_DO_NOT_CONTACT) ? "NIE_KONTAKTOWAC" : null,
      source: lowerTags.has(TAG_WEB_FORM) ? "FORMULARZ_WWW" : null,
      legacyHubspotTag: tags.size ? [...tags].join("; ") : null,
      contacts,
      snapshot: {
        company: primary.company,
        address: primary.address,
        city: primary.city,
        zip: primary.zip,
        country: primary.country,
        nip: primary.nip,
        ustalona_cena_transportu: primary.ustalona_cena_transportu,
      },
    });

    if (contacts.length > 1) {
      report.multiPersonClients.push({ key, name, people: sorted.map(contactLabel) });
    }
  }

  for (const [email, who] of emails) if (who.length > 1) report.duplicateEmails.push({ email, contacts: who });

  const byName = new Map<string, number>();
  for (const c of clients) if (!c.hubspotCompanyId) byName.set(normalizeName(c.name), (byName.get(normalizeName(c.name)) ?? 0) + 1);
  for (const [name, count] of byName) if (count > 1) report.possibleDuplicateNames.push({ name, count });

  clients.sort((a, b) => a.name.localeCompare(b.name, "pl"));
  report.clientsPlanned = clients.length;
  return { clients, report };
}
