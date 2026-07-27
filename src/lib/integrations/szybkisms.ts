export type IntegrationTestResult = { ok: boolean; message: string };

const API_BASE = "https://api.szybkisms.pl/rest";

export function getSzybkiSmsConfigStatus(): { configured: boolean } {
  return { configured: Boolean(process.env.SZYBKISMS_API_TOKEN) };
}

export async function testSzybkiSmsConnection(): Promise<IntegrationTestResult> {
  const token = process.env.SZYBKISMS_API_TOKEN;
  if (!token) {
    return { ok: false, message: "Brak SZYBKISMS_API_TOKEN — zapisz token wyżej, żeby przetestować połączenie." };
  }

  try {
    const res = await fetch(`${API_BASE}/account`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.message || `SzybkiSMS API zwróciło błąd (HTTP ${res.status}).`);
    }

    const credit = body?.credit ?? "?";
    const currency = body?.currency ?? "";
    return { ok: true, message: `Połączono — saldo konta: ${credit} ${currency}`.trim() + "." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
