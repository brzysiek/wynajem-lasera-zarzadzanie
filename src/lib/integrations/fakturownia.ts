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

  const issueDate = new Date();
  // Termin płatności — jawnie 7 dni od wystawienia, niezależnie od domyślnego
  // szablonu na koncie Fakturowni (który dawał 1 dzień — zgłoszone jako za
  // krótkie). `payment_to` jako konkretna data, nie liczba dni, żeby nie
  // zależeć od interpretacji tego pola przez Fakturownię.
  const paymentTo = new Date(issueDate);
  paymentTo.setDate(paymentTo.getDate() + 7);

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
        issue_date: isoDate(issueDate),
        payment_to: isoDate(paymentTo),
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

// Podsumowanie faktury z Fakturowni — dashboard `/finanse/faktury` czyta na
// żywo z tego źródła (nie z naszej bazy), żeby nie duplikować stanu, który i
// tak może się zmienić po stronie Fakturowni (poprawki, ręczna wysyłka).
export type FakturowniaInvoiceSummary = {
  id: number;
  number: string;
  buyerName: string;
  sellDate: string; // YYYY-MM-DD
  paymentTo: string; // YYYY-MM-DD — termin płatności (patrz createInvoice: zawsze 7 dni od wystawienia)
  priceGross: string;
  currency: string;
  // gov_status: null = niewysłana do KSeF, "ok" = przyjęta, inne = błąd/w toku.
  govStatus: string | null;
  govId: string | null; // numer referencyjny UPO, dostępny gdy govStatus === "ok"
};

function toInvoiceSummary(raw: {
  id: number;
  number: string;
  buyer_name: string;
  sell_date: string;
  payment_to: string;
  price_gross: string;
  currency: string;
  gov_status: string | null;
  gov_id: string | null;
}): FakturowniaInvoiceSummary {
  return {
    id: raw.id,
    number: raw.number,
    buyerName: raw.buyer_name,
    sellDate: raw.sell_date,
    paymentTo: raw.payment_to,
    priceGross: raw.price_gross,
    currency: raw.currency,
    govStatus: raw.gov_status ?? null,
    govId: raw.gov_id ?? null,
  };
}

// Lista faktur VAT z naszego działu. Bez statusu płatności — Fakturownia go
// nie zna bez płatnego połączenia z bankiem (ustalone z użytkownikiem),
// więc `status`/`paid` z ich API świadomie pomijamy jako niemiarodajne.
// Bez `dateFrom`/`dateTo` (np. przy dopasowywaniu wyciągu bankowego, gdzie
// faktura mogła zostać wystawiona w innym okresie niż zapłacona) pobiera
// WSZYSTKIE faktury działu (`period=all`).
export async function listInvoices(input?: { dateFrom: string; dateTo: string }): Promise<FakturowniaInvoiceSummary[]> {
  const { token, account } = requireCredentials();
  const departmentId = requireDepartmentId();

  const results: FakturowniaInvoiceSummary[] = [];
  let page = 1;
  const perPage = 100;
  for (;;) {
    const params = new URLSearchParams({
      api_token: token,
      department_id: String(departmentId),
      kind: "vat",
      page: String(page),
      per_page: String(perPage),
      ...(input ? { period: "more", date_from: input.dateFrom, date_to: input.dateTo } : { period: "all" }),
    });
    const res = await fetch(`${baseUrl(account)}/invoices.json?${params.toString()}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body && typeof body === "object" && "message" in body ? String(body.message) : null;
      throw new Error(message || `Fakturownia API zwróciło błąd (HTTP ${res.status}).`);
    }
    const list = Array.isArray(body) ? body : [];
    results.push(...list.map(toInvoiceSummary));
    if (list.length < perPage) break;
    page += 1;
  }

  logDebug("fakturownia_invoices_listed", { count: results.length, ...input });
  return results;
}

// Wysyłka JUŻ ISTNIEJĄCEJ faktury do KSeF na żądanie (ręczny przycisk w
// dashboardzie) — inny mechanizm niż `gov_save_and_send` przy tworzeniu
// (createInvoice wyżej celowo go nie używa). To jedyne miejsce w kodzie,
// które świadomie prosi o wysyłkę do KSeF.
export async function sendInvoiceToKsef(invoiceId: number): Promise<FakturowniaInvoiceSummary> {
  const { token, account } = requireCredentials();
  const params = new URLSearchParams({ api_token: token, send_to_ksef: "yes" });
  const res = await fetch(`${baseUrl(account)}/invoices/${invoiceId}.json?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "message" in body ? String(body.message) : null;
    throw new Error(message || `Fakturownia API zwróciło błąd (HTTP ${res.status}).`);
  }
  logDebug("fakturownia_invoice_sent_to_ksef", { invoiceId, govStatus: body?.gov_status });
  return toInvoiceSummary(body);
}

// Szczegóły JEDNEJ faktury — numer (temat/nazwa pliku szkicu maila) i termin
// płatności (przypomnienie o płatności, patrz remind-draft/route.ts). CELOWO
// nie zwraca e-maila kontrahenta z Fakturowni — ustalone z użytkownikiem:
// adres do szkicu ma pochodzić wyłącznie z HubSpota
// (Rental.contactEmailCache), bo karta kontrahenta w Fakturowni bywa
// nieaktualna/wpisana ręcznie.
export type FakturowniaInvoiceDetail = { number: string; paymentTo: string };

export async function getInvoiceDetail(invoiceId: number): Promise<FakturowniaInvoiceDetail> {
  const { token, account } = requireCredentials();
  const res = await fetch(`${baseUrl(account)}/invoices/${invoiceId}.json?api_token=${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "message" in body ? String(body.message) : null;
    throw new Error(message || `Fakturownia API zwróciło błąd (HTTP ${res.status}).`);
  }
  return { number: body.number, paymentTo: body.payment_to };
}

// PDF faktury — używany zarówno do załącznika w szkicu maila
// (src/lib/integrations/gmail.ts), jak i do podglądu w dashboardzie
// (GET /api/fakturownia/invoices/[id]/pdf, proxy przez nasz serwer, żeby nie
// wystawiać tokenu Fakturowni bezpośrednio do przeglądarki).
export async function getInvoicePdf(invoiceId: number): Promise<Buffer> {
  const { token, account } = requireCredentials();
  const res = await fetch(`${baseUrl(account)}/invoices/${invoiceId}.pdf?api_token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    throw new Error(`Fakturownia API zwróciło błąd przy pobieraniu PDF-a (HTTP ${res.status}).`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Historia klienta (CRM, prompt 3B): WSZYSTKIE faktury VAT działu z polami
// potrzebnymi do dopasowania (NIP nabywcy, netto). Osobna funkcja, żeby nie
// zmieniać kształtu FakturowniaInvoiceSummary używanego przez dashboard faktur.
export type FakturowniaHistoryInvoice = {
  id: number;
  number: string;
  issueDate: string; // YYYY-MM-DD
  sellDate: string; // YYYY-MM-DD
  buyerName: string;
  buyerTaxNo: string | null;
  priceNet: string;
  priceGross: string;
  // Lista faktur zwykle nie zawiera pozycji — wtedy null i trzeba je doczytać
  // przez getInvoicePositionNames.
  positionNames: string[] | null;
};

export async function listInvoicesForHistory(): Promise<FakturowniaHistoryInvoice[]> {
  const { token, account } = requireCredentials();
  const departmentId = requireDepartmentId();
  const results: FakturowniaHistoryInvoice[] = [];
  const perPage = 100;
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({
      api_token: token,
      department_id: String(departmentId),
      kind: "vat",
      period: "all",
      page: String(page),
      per_page: String(perPage),
    });
    const res = await fetch(`${baseUrl(account)}/invoices.json?${params.toString()}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body && typeof body === "object" && "message" in body ? String(body.message) : null;
      throw new Error(message || `Fakturownia API zwróciło błąd (HTTP ${res.status}).`);
    }
    const list: Record<string, unknown>[] = Array.isArray(body) ? body : [];
    for (const raw of list) {
      const positions = Array.isArray(raw.positions) ? (raw.positions as { name?: string }[]) : null;
      results.push({
        id: Number(raw.id),
        number: String(raw.number ?? ""),
        issueDate: String(raw.issue_date ?? raw.sell_date ?? ""),
        sellDate: String(raw.sell_date ?? raw.issue_date ?? ""),
        buyerName: String(raw.buyer_name ?? ""),
        buyerTaxNo: raw.buyer_tax_no ? String(raw.buyer_tax_no) : null,
        priceNet: String(raw.price_net ?? "0"),
        priceGross: String(raw.price_gross ?? "0"),
        positionNames: positions ? positions.map((p) => String(p.name ?? "")).filter(Boolean) : null,
      });
    }
    if (list.length < perPage) break;
  }
  logDebug("fakturownia_history_invoices_listed", { count: results.length });
  return results;
}

export async function getInvoicePositionNames(invoiceId: number): Promise<string[]> {
  const { token, account } = requireCredentials();
  const res = await fetch(`${baseUrl(account)}/invoices/${invoiceId}.json?api_token=${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "message" in body ? String(body.message) : null;
    throw new Error(message || `Fakturownia API zwróciło błąd (HTTP ${res.status}).`);
  }
  const positions: { name?: string }[] = Array.isArray(body?.positions) ? body.positions : [];
  return positions.map((p) => String(p.name ?? "")).filter(Boolean);
}
