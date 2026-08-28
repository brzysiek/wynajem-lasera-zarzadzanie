import { logDebug } from "@/lib/logger";

export type IntegrationTestResult = { ok: boolean; message: string };

export type HubspotContactSummary = {
  id: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
};

export type HubspotContactDetail = HubspotContactSummary & {
  address: string | null;
  city: string | null;
  zip: string | null;
  country: string | null;
  transportPrice: string | null;
};

// Custom contact property holding the agreed transport price for this client.
const TRANSPORT_PRICE_PROPERTY = "ustalona_cena_transportu";

export function getHubspotConfigStatus(): { configured: boolean } {
  return { configured: Boolean(process.env.HUBSPOT_ACCESS_TOKEN) };
}

function requireToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    throw new Error("Brak HUBSPOT_ACCESS_TOKEN — skonfiguruj token w Ustawieniach → Integracje.");
  }
  return token;
}

function toContactSummary(item: { id: string; properties?: Record<string, string | null> }): HubspotContactSummary {
  const p = item.properties ?? {};
  return {
    id: item.id,
    firstname: p.firstname ?? null,
    lastname: p.lastname ?? null,
    email: p.email ?? null,
    phone: p.phone ?? null,
    company: p.company ?? null,
  };
}

// Search fields per spec: firstname/lastname/email/phone/company, OR'd together
// (each filterGroup is AND-ed internally, multiple groups are OR-ed by HubSpot).
const SEARCH_PROPERTIES = ["firstname", "lastname", "email", "phone", "company"];

export async function searchHubspotContacts(query: string): Promise<HubspotContactSummary[]> {
  const token = requireToken();
  const value = `*${query}*`;

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      filterGroups: SEARCH_PROPERTIES.map((propertyName) => ({
        filters: [{ propertyName, operator: "CONTAINS_TOKEN", value }],
      })),
      properties: SEARCH_PROPERTIES,
      limit: 10,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.message || `HubSpot API zwróciło błąd (HTTP ${res.status}).`);
  }

  const results = (body.results ?? []).map(toContactSummary);
  logDebug("hubspot_contacts_searched", { query, resultCount: results.length });
  return results;
}

export async function getHubspotContact(id: string): Promise<HubspotContactDetail> {
  const token = requireToken();
  const properties = `firstname,lastname,email,phone,company,address,city,zip,country,${TRANSPORT_PRICE_PROPERTY}`;

  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(id)}?properties=${properties}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.message || `HubSpot API zwróciło błąd (HTTP ${res.status}).`);
  }

  logDebug("hubspot_contact_fetched", { id });
  const p = body.properties ?? {};
  return {
    id: body.id,
    firstname: p.firstname ?? null,
    lastname: p.lastname ?? null,
    email: p.email ?? null,
    phone: p.phone ?? null,
    company: p.company ?? null,
    address: p.address ?? null,
    city: p.city ?? null,
    zip: p.zip ?? null,
    country: p.country ?? null,
    transportPrice: p[TRANSPORT_PRICE_PROPERTY] ?? null,
  };
}

export function formatHubspotAddress(contact: { address: string | null; city: string | null; zip: string | null; country: string | null }): string | null {
  const cityLine = [contact.zip, contact.city].filter(Boolean).join(" ");
  const parts = [contact.address, cityLine, contact.country].map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(", ") : null;
}

// Requires HUBSPOT_PORTAL_ID in .env (Hub ID, visible in the HubSpot account
// URL or Settings → Account Setup) — the Private App token API doesn't expose
// it directly, so it can't be derived automatically.
export function getHubspotContactUrl(id: string): string | null {
  const portalId = process.env.HUBSPOT_PORTAL_ID;
  return portalId ? `https://app.hubspot.com/contacts/${portalId}/contact/${id}` : null;
}

export async function testHubspotConnection(): Promise<IntegrationTestResult> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return { ok: false, message: "Brak HUBSPOT_ACCESS_TOKEN — zapisz token wyżej, żeby przetestować połączenie." };
  }

  try {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message || `HubSpot API zwróciło błąd (HTTP ${res.status}).`);
    }

    return { ok: true, message: "Połączono — token ma dostęp do kontaktów HubSpot." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
