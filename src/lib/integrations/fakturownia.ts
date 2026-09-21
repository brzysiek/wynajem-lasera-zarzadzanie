import { logDebug } from "@/lib/logger";

export type IntegrationTestResult = { ok: boolean; message: string };

export type FakturowniaDepartment = { id: number; name: string };

// Dwie zmienne, nie jedna (jak HubSpot/SzybkiSMS) — Fakturownia identyfikuje
// konto po subdomenie (https://{account}.fakturownia.pl), token sam w sobie
// nie wystarczy do zbudowania URL-a.
export function getFakturowniaConfigStatus(): { configured: boolean } {
  return {
    configured: Boolean(
      process.env.FAKTUROWNIA_API_TOKEN && process.env.FAKTUROWNIA_ACCOUNT && process.env.FAKTUROWNIA_DEPARTMENT_ID,
    ),
  };
}

// Dział, z którego wystawiane są faktury (ustalone z użytkownikiem: dział
// "wynajemlasera", https://tslizowski.fakturownia.pl/departments/1868546/).
export function getFakturowniaDepartmentId(): number | null {
  const raw = process.env.FAKTUROWNIA_DEPARTMENT_ID;
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function requireCredentials(): { token: string; account: string } {
  const token = process.env.FAKTUROWNIA_API_TOKEN;
  const account = process.env.FAKTUROWNIA_ACCOUNT;
  if (!token || !account) {
    throw new Error("Brak FAKTUROWNIA_API_TOKEN / FAKTUROWNIA_ACCOUNT — skonfiguruj w Ustawieniach → Integracje.");
  }
  return { token, account };
}

function baseUrl(account: string): string {
  return `https://${account}.fakturownia.pl`;
}

// Lista działów (departments) na koncie — oprócz realnego zastosowania
// (wybór działu, z którego wystawiana jest faktura — patrz plan wdrożenia)
// służy dziś głównie jako lekki, tani test połączenia (testFakturowniaConnection
// niżej), bo nie wymaga żadnych parametrów poza samym tokenem.
export async function listFakturowniaDepartments(): Promise<FakturowniaDepartment[]> {
  const { token, account } = requireCredentials();
  const res = await fetch(`${baseUrl(account)}/departments.json?api_token=${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "message" in body ? String(body.message) : null;
    throw new Error(message || `Fakturownia API zwróciło błąd (HTTP ${res.status}).`);
  }
  const list = Array.isArray(body) ? body : [];
  logDebug("fakturownia_departments_listed", { count: list.length });
  return list.map((d: { id: number; name: string }) => ({ id: d.id, name: d.name }));
}

export async function testFakturowniaConnection(): Promise<IntegrationTestResult> {
  const token = process.env.FAKTUROWNIA_API_TOKEN;
  const account = process.env.FAKTUROWNIA_ACCOUNT;
  if (!token || !account) {
    return { ok: false, message: "Brak tokenu/konta — zapisz je wyżej, żeby przetestować połączenie." };
  }

  try {
    const departments = await listFakturowniaDepartments();
    const names = departments.length > 0 ? departments.map((d) => `${d.name} (id ${d.id})`).join(", ") : "brak zdefiniowanych działów";
    return { ok: true, message: `Połączono z ${account}.fakturownia.pl. Działy na koncie: ${names}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// UWAGA: wystawianie faktur (findClientByTaxNo / createInvoice) celowo
// jeszcze nie ma tu implementacji — czeka na ustalenie z użytkownikiem:
// tytułu pozycji na fakturze i department_id, z którego mają być wystawiane
// (patrz lista z testFakturowniaConnection powyżej). KSeF: OMIJAMY przez
// nieustawianie `gov_save_and_send` w payloadzie POST /invoices.json — samo
// pominięcie tej flagi wystarczy, dopóki na koncie nie jest włączone
// automatyczne wysyłanie (Fakturownia → Ustawienia → KSeF, nie przez API).
