import { requireToken } from "@/lib/integrations/hubspot";
import { logDebug } from "@/lib/logger";

// Odczyt transakcji (lejek „Proces sprzedaży”), ich notatek i wyszukiwanie
// kontaktu po e-mailu — pod Sygnały (CRM, prompt 2A). TYLKO ODCZYT: w tym
// pliku nie ma żadnego zapisu do HubSpota (odsyłanie to krok 2B).
//
// Właściwości zweryfikowane na prawdziwych danych 26.09.2026: telefon z
// formularza n8n zapisuje w `telefon_z_szansy` („Telefon z sygnału”), resztę
// formularza w `description` (patrz src/lib/leads/parse-deal.ts).

export const DEAL_PROPERTIES = [
  "dealname",
  "dealstage",
  "pipeline",
  "createdate",
  "description",
  "telefon_z_szansy",
  "closed_lost_reason",
  "hs_lastmodifieddate",
];

export type HsDeal = {
  id: string;
  properties: Record<string, string | null>;
  contactIds: string[];
};

export type HsNote = { id: string; body: string | null; timestamp: string | null };

async function hs(path: string, init?: RequestInit) {
  const token = requireToken();
  const res = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message ? String(body.message) : `HTTP ${res.status}`;
    const err = new Error(`HubSpot: ${message}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body;
}

// Etapy lejka „default” — weryfikacja mapowania przed importem.
export async function fetchDefaultPipelineStageIds(): Promise<{ id: string; label: string }[]> {
  const body = await hs("/crm/v3/pipelines/deals");
  const pipeline = (body?.results ?? []).find((p: { id: string }) => p.id === "default");
  return (pipeline?.stages ?? []).map((s: { id: string; label: string }) => ({ id: s.id, label: s.label }));
}

// Wszystkie transakcje (~500) z powiązanymi kontaktami — lista zamiast
// wyszukiwarki: prościej i bez limitu 10 tys. wyników; 5–6 zapytań.
export async function fetchAllDeals(): Promise<HsDeal[]> {
  const deals: HsDeal[] = [];
  let after: string | undefined;
  do {
    const params = new URLSearchParams({ limit: "100", properties: DEAL_PROPERTIES.join(","), associations: "contacts", archived: "false" });
    if (after) params.set("after", after);
    const body = await hs(`/crm/v3/objects/deals?${params.toString()}`);
    for (const item of body?.results ?? []) {
      deals.push({
        id: String(item.id),
        properties: item.properties ?? {},
        contactIds: (item.associations?.contacts?.results ?? []).map((r: { id: string }) => String(r.id)),
      });
    }
    after = body?.paging?.next?.after;
  } while (after);
  logDebug("hubspot_deals_fetched", { count: deals.length });
  return deals;
}

// Notatki powiązane z transakcjami (historia Ani z HubSpota) — batch API.
export async function fetchDealNotes(dealIds: string[]): Promise<Map<string, HsNote[]>> {
  const byDeal = new Map<string, HsNote[]>();
  if (dealIds.length === 0) return byDeal;
  const noteIdsByDeal = new Map<string, string[]>();
  for (let i = 0; i < dealIds.length; i += 500) {
    const body = await hs("/crm/v4/associations/deals/notes/batch/read", {
      method: "POST",
      body: JSON.stringify({ inputs: dealIds.slice(i, i + 500).map((id) => ({ id })) }),
    });
    for (const r of body?.results ?? []) {
      noteIdsByDeal.set(String(r.from?.id), (r.to ?? []).map((t: { toObjectId: string | number }) => String(t.toObjectId)));
    }
  }
  const allNoteIds = [...new Set([...noteIdsByDeal.values()].flat())];
  const notes = new Map<string, HsNote>();
  for (let i = 0; i < allNoteIds.length; i += 100) {
    const body = await hs("/crm/v3/objects/notes/batch/read", {
      method: "POST",
      body: JSON.stringify({ properties: ["hs_note_body", "hs_timestamp"], inputs: allNoteIds.slice(i, i + 100).map((id) => ({ id })) }),
    });
    for (const n of body?.results ?? []) {
      notes.set(String(n.id), { id: String(n.id), body: n.properties?.hs_note_body ?? null, timestamp: n.properties?.hs_timestamp ?? null });
    }
  }
  for (const [dealId, ids] of noteIdsByDeal) {
    byDeal.set(dealId, ids.map((id) => notes.get(id)).filter((n): n is HsNote => Boolean(n)));
  }
  logDebug("hubspot_deal_notes_fetched", { deals: dealIds.length, notes: notes.size });
  return byDeal;
}

// Kontakt HubSpot po e-mailu — żeby klient utworzony z sygnału dostał
// hubspotContactId i import klientów (1B) nie zrobił z niego duplikatu.
export async function findHubspotContactByEmail(
  email: string,
): Promise<{ id: string; firstname: string | null; lastname: string | null; phone: string | null } | null> {
  const body = await hs("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      properties: ["firstname", "lastname", "phone", "mobilephone"],
      limit: 1,
    }),
  });
  const c = body?.results?.[0];
  if (!c) return null;
  return {
    id: String(c.id),
    firstname: c.properties?.firstname ?? null,
    lastname: c.properties?.lastname ?? null,
    phone: c.properties?.phone ?? c.properties?.mobilephone ?? null,
  };
}

export function hubspotDealUrl(dealId: string): string | null {
  const portal = process.env.HUBSPOT_PORTAL_ID;
  return portal ? `https://app.hubspot.com/contacts/${portal}/record/0-3/${dealId}` : null;
}
