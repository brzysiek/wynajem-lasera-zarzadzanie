export type IntegrationTestResult = { ok: boolean; message: string };

export function getHubspotConfigStatus(): { configured: boolean } {
  return { configured: Boolean(process.env.HUBSPOT_ACCESS_TOKEN) };
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
