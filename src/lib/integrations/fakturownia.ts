import { logDebug } from "@/lib/logger";
import type { InvoicePosition } from "@/lib/invoicing/positions";

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

function requireDepartmentId(): number {
  const id = getFakturowniaDepartmentId();
  if (!id) {
    throw new Error("Brak FAKTUROWNIA_DEPARTMENT_ID — skonfiguruj dział w Ustawieniach → Integracje.");
  }
  return id;
}

// Fakturownia szuka po `tax_no` w formacie czystych cyfr (bez myślników) —
// NIP z HubSpot/formularza może przyjść z myślnikami ("123-456-32-18"),
// więc normalizujemy przed zapytaniem.
function normalizeTaxNo(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

export type FakturowniaClient = { id: number; name: string };

export async function findClientByTaxNo(taxNo: string): Promise<FakturowniaClient | null> {
  const { token, account } = requireCredentials();
  const normalized = normalizeTaxNo(taxNo);
  if (!normalized) return null;

  const res = await fetch(
    `${baseUrl(account)}/clients.json?tax_no=${encodeURIComponent(normalized)}&api_token=${encodeURIComponent(token)}`,
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "message" in body ? String(body.message) : null;
    throw new Error(message || `Fakturownia API zwróciło błąd (HTTP ${res.status}).`);
  }

  const list = Array.isArray(body) ? body : [];
  if (list.length === 0) return null;
  const first = list[0] as { id: number; name: string };
  logDebug("fakturownia_client_found", { taxNo: normalized, clientId: first.id });
  return { id: first.id, name: first.name };
}

export type CreatedInvoice = { id: number; number: string };

// Wystawia fakturę VAT z ustalonego działu (department_id) dla znalezionego
// wcześniej kontrahenta. CELOWO bez `gov_save_and_send` w payloadzie — apka
// ma tylko WYSTAWIĆ fakturę, wysyłka do KSeF zostaje ręczna, poza tą apką
// (ustalone z użytkownikiem). Fakturownia domyślnie NIE wysyła faktur
// utworzonych przez API do KSeF, dopóki na koncie nie jest włączone
// auto-wysyłanie (ustawienie po stronie Fakturowni, nie przez API) — samo
// pominięcie tej flagi więc wystarcza, ale nie jest jedyną linią obrony:
// gdyby kiedyś ktoś włączył auto-wysyłanie na koncie, ta funkcja i tak nigdy
// świadomie nie prosi o wysyłkę.
export async function createInvoice(input: {
  clientId: number;
  sellDate: Date;
  positions: InvoicePosition[];
}): Promise<CreatedInvoice> {
  const { token, account } = requireCredentials();
  const departmentId = requireDepartmentId();
  // UWAGA: `toISOString()` konwertuje do UTC — serwer działa w Europe/Warsaw
  // (UTC+1/+2), więc dla dat blisko północy cofnąłby dzień o jeden (np.
  // endsAt = 19.09 00:00 lokalnie → 18.09 22:00 UTC → "18.09" na fakturze,
  // dokładnie ten bug). Zamiast tego bierzemy datę kalendarzową z lokalnych
  // gettery Date (getFullYear/getMonth/getDate), tak jak dayIndex() w
  // src/lib/pricing/duration.ts z tego samego powodu.
  const isoDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const res = await fetch(`${baseUrl(account)}/invoices.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      api_token: token,
      invoice: {
        kind: "vat",
        department_id: departmentId,
        client_id: input.clientId,
        sell_date: isoDate(input.sellDate),
        issue_date: isoDate(new Date()),
        positions: input.positions.map((p) => ({
          name: p.name,
          quantity: p.quantity,
          tax: p.taxLabel,
          total_price_gross: p.totalPriceGross.toNumber(),
        })),
      },
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "message" in body ? String(body.message) : null;
    throw new Error(message || `Fakturownia API zwróciło błąd (HTTP ${res.status}).`);
  }

  logDebug("fakturownia_invoice_created", { id: body?.id, number: body?.number });
  return { id: body.id, number: body.number };
}
