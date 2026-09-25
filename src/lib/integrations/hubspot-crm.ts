import { requireToken } from "@/lib/integrations/hubspot";
import { logDebug } from "@/lib/logger";
import type { HsCompany, HsContact } from "@/lib/clients/hubspot-import";

// Pełne pobranie kontaktów i firm z HubSpota — pod import klientów (CRM,
// etap 1B). TYLKO ODCZYT: żadnych zapisów do HubSpota w tym pliku.
// Osobny plik obok hubspot.ts, żeby nie ruszać wyszukiwarki kontaktów, z
// której formularz wynajmu korzysta dziś.
//
// Właściwości zweryfikowane przez API 25.09.2026 (nie zakładane):
// `nip` (number), `ustalona_cena_transportu` (number), `odlegosc_od_bazy`
// (string), `tagi` i `urzadzenie` (wielokrotny wybór) — wszystkie na
// kontaktach; firmy nie mają żadnych własnych właściwości.

const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "mobilephone",
  "company",
  "address",
  "city",
  "zip",
  "country",
  "nip",
  "ustalona_cena_transportu",
  "odlegosc_od_bazy",
  "tagi",
  "urzadzenie",
  "createdate",
];
const COMPANY_PROPERTIES = ["name", "address", "city", "zip", "country"];
const PAGE_SIZE = 100;

type HsListItem = {
  id: string;
  properties?: Record<string, string | null>;
  associations?: { companies?: { results?: { id: string }[] } };
};

async function fetchAllPages(objectType: "contacts" | "companies", properties: string[], withCompanies: boolean) {
  const token = requireToken();
  const items: HsListItem[] = [];
  let after: string | undefined;
  do {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), properties: properties.join(","), archived: "false" });
    if (withCompanies) params.set("associations", "companies");
    if (after) params.set("after", after);
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body?.message ? String(body.message) : `HTTP ${res.status}`;
      throw new Error(`HubSpot (${objectType}): ${message}`);
    }
    items.push(...((body?.results ?? []) as HsListItem[]));
    after = body?.paging?.next?.after;
  } while (after);
  logDebug("hubspot_crm_fetched", { objectType, count: items.length });
  return items;
}

const prop = (item: HsListItem, key: string) => item.properties?.[key] ?? null;

export async function fetchAllHubspotContacts(): Promise<HsContact[]> {
  const items = await fetchAllPages("contacts", CONTACT_PROPERTIES, true);
  return items.map((item) => ({
    id: item.id,
    firstname: prop(item, "firstname"),
    lastname: prop(item, "lastname"),
    email: prop(item, "email"),
    phone: prop(item, "phone"),
    mobilephone: prop(item, "mobilephone"),
    company: prop(item, "company"),
    address: prop(item, "address"),
    city: prop(item, "city"),
    zip: prop(item, "zip"),
    country: prop(item, "country"),
    nip: prop(item, "nip"),
    ustalona_cena_transportu: prop(item, "ustalona_cena_transportu"),
    odlegosc_od_bazy: prop(item, "odlegosc_od_bazy"),
    tagi: prop(item, "tagi"),
    urzadzenie: prop(item, "urzadzenie"),
    createdate: prop(item, "createdate"),
    // HubSpot potrafi zwrócić to samo powiązanie dwa razy (etykieta
    // "primary" + zwykła) — deduplikujemy.
    companyIds: [...new Set((item.associations?.companies?.results ?? []).map((r) => r.id))],
  }));
}

export async function fetchAllHubspotCompanies(): Promise<HsCompany[]> {
  const items = await fetchAllPages("companies", COMPANY_PROPERTIES, false);
  return items.map((item) => ({
    id: item.id,
    name: prop(item, "name"),
    address: prop(item, "address"),
    city: prop(item, "city"),
    zip: prop(item, "zip"),
    country: prop(item, "country"),
  }));
}
